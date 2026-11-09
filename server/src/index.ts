import cors from 'cors';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { localVectorStore } from './rag/local_store';
import { handleVoiceWebSocket } from './ws/voice_handler';
import * as accounts from './services/accounts';

const app = express();
app.use(cors({ origin: false }));
app.use(express.json({ limit: '32kb' }));
// Mutating requests must originate from the same site as the application.
app.use((req,res,next) => { if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.headers.origin) { try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({error:'Origin not allowed'}); } catch { return res.status(403).json({error:'Origin not allowed'}); } } next(); });
// Bound authentication attempts per process to reduce brute-force abuse.
const attempts = new Map<string, { count: number; reset: number }>();
app.use('/api/auth', (req,res,next) => { if (req.method !== 'POST' || !['/login','/signup'].includes(req.path)) return next(); const now=Date.now(); const key=req.ip || 'unknown'; let entry=attempts.get(key); if (!entry || entry.reset <= now) { entry={count:0,reset:now+15*60*1000}; attempts.set(key,entry); } if (++entry.count > 20) return res.status(429).json({error:'Too many attempts. Please try again later.'}); next(); });
setInterval(() => { const now=Date.now(); for (const [key,entry] of attempts) if (entry.reset <= now) attempts.delete(key); }, 15*60*1000).unref();
localVectorStore.init();
const cookie = (token: string) => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${config.nodeEnv === 'production' ? '; Secure' : ''}`;
const route = (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>): express.RequestHandler => (req,res,next) => { void fn(req,res,next).catch(next); };
app.post('/api/auth/signup', route(async (req,res) => { try { const user = await accounts.signup(String(req.body.email || ''),String(req.body.password || ''),String(req.body.name || '')); res.setHeader('Set-Cookie',cookie(await accounts.createSession(user))); res.status(201).json(user); } catch(e: any) { if (/^(Enter your name|This address|An account)/.test(e.message)) return res.status(400).json({ error:e.message }); throw e; } }));
app.post('/api/auth/login', route(async (req,res) => { try { const user = await accounts.login(String(req.body.email || ''),String(req.body.password || '')); res.setHeader('Set-Cookie',cookie(await accounts.createSession(user))); res.json(user); } catch(e: any) { if (e.message === 'Invalid email or password.') return res.status(401).json({error:e.message}); throw e; } }));
app.post('/api/auth/logout', route(async (req,res) => { await accounts.endSession(req.headers.cookie); res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ok:true}); }));
app.get('/api/auth/me', route(async (req,res) => { const user = await accounts.sessionFromCookie(req.headers.cookie); if (!user) return res.status(401).json({error:'Sign in required'}); res.json(user); }));
app.get('/api/health', route(async (_req,res) => { try { await accounts.databaseReady(); res.json({status:'ok',database:'connected',gnaniMock:config.gnani.isMock,llmMock:config.llm.isMock}); } catch { res.status(503).json({status:'unavailable',database:'disconnected'}); } }));
app.use('/api', route(async (req,res,next) => { const user = await accounts.sessionFromCookie(req.headers.cookie); if (!user) return res.status(401).json({error:'Sign in required'}); res.locals.user=user; next(); }));
app.get('/api/history', route(async (_req,res) => res.json(await accounts.getMessages(res.locals.user.id))));
app.get('/api/tickets', route(async (_req,res) => res.json(await accounts.getTickets(res.locals.user))));
app.post('/api/tickets', route(async (req,res) => { const query=String(req.body.query || '').trim().slice(0,4000); if (!query) return res.status(400).json({error:'A question is required'}); if (res.locals.user.isAdmin) return res.status(403).json({error:'Admin accounts cannot create customer tickets.'}); res.status(201).json(await accounts.createTicket(res.locals.user,String(req.body.language || 'en').slice(0,10),query,String(req.body.summary || '').slice(0,4000))); }));
app.patch('/api/tickets/:id', route(async (req,res) => { if (!res.locals.user.isAdmin) return res.status(403).json({error:'Admin access required'}); const ticket=await accounts.updateTicket(String(req.params.id),req.body); if (!ticket) return res.status(404).json({error:'Ticket not found'}); res.json(ticket); }));
app.use((err: Error,_req: express.Request,res: express.Response,_next: express.NextFunction) => { console.error('Request failed:',err); res.status(500).json({error:'The service is temporarily unavailable.'}); });
const clientDir = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(path.join(clientDir, 'index.html'))) { app.use(express.static(clientDir)); app.get('*', (req,res,next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientDir, 'index.html'))); }
const server=http.createServer(app);
const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024});
server.on('upgrade',(req,socket,head) => { void (async () => { try { const user=await accounts.sessionFromCookie(req.headers.cookie); const origin=req.headers.origin; if (!user || req.url !== '/ws/voice' || (origin && new URL(origin).host !== req.headers.host)) { socket.destroy(); return; } wss.handleUpgrade(req,socket,head,ws => handleVoiceWebSocket(ws,user)); } catch { socket.destroy(); } })(); });
if (config.nodeEnv === 'production' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) { console.error('Set ADMIN_PASSWORD to at least 12 characters in production.'); process.exit(1); }
accounts.initDatabase().then(() => server.listen(config.port,() => console.log(`VoiceDesk listening on ${config.port}`))).catch(err => { console.error('Database startup failed:',err.message); process.exitCode=1; });
