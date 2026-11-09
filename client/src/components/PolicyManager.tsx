import React, { useEffect, useState } from 'react';
import { FileText, Trash2, UploadCloud } from 'lucide-react';

type Policy = { docId: string; title: string; filename: string; version: number; passages: number; updatedAt: string };
export function PolicyManager({ onChanged }: { onChanged: () => void }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [docId, setDocId] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [backendReady, setBackendReady] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  async function refresh() {
    const res = await fetch('/api/admin/policies');
    if (!res.ok) throw new Error('Could not load uploaded policies.');
    setPolicies(await res.json());
  }
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/health');
        const health = await response.json();
        if (!response.ok || health.backend !== 'python') {
          setMessage('The old backend is running. Stop it and start the Python server before uploading policies.');
          return;
        }
        setBackendReady(true);
        await refresh();
      } catch { setMessage('Cannot connect to the Python server. Start it and try again.'); }
    })();
  }, []);
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setMessage('Choose a file no larger than 5 MB.'); return; }
    setBusy(true); setMessage('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const res = await fetch('/api/admin/policies', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({docId:docId.trim(), title:title.trim(), filename:file.name, contentBase64:btoa(binary)}) });
      const result = await res.json().catch(() => ({}));
      if (res.status === 413) throw new Error('The server rejected the file size. Make sure the Python backend is running and the file is under 5 MB.');
      if (!res.ok) throw new Error(result.error || 'Could not upload this policy.');
      setMessage(`Policy ${result.docId} is live (version ${result.version}, ${result.passages} passages).`);
      setDocId(''); setTitle(''); setFile(null); setInputKey(k => k + 1); await refresh(); onChanged();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not upload this policy.'); }
    finally { setBusy(false); }
  }
  async function remove(policy: Policy) {
    if (!window.confirm(`Remove ${policy.title}? Its searchable passages will be deleted. Keep a copy of the original file if you may need it again.`)) return;
    setBusy(true); setMessage('');
    try {
      const res = await fetch(`/api/admin/policies/${encodeURIComponent(policy.docId)}`, {method:'DELETE'});
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Could not remove the policy.');
      await refresh(); onChanged(); setMessage(`Policy ${policy.docId} was removed.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not remove the policy.'); }
    finally { setBusy(false); }
  }
  return <section className="policy-manager"><div className="policy-heading"><div><div className="eyebrow">KNOWLEDGE BASE</div><h3>Keep answers current.</h3><p>Upload a text-based PDF, Markdown or text policy. Uploaded documents become the active knowledge base. A matching ID replaces that document immediately.</p></div><FileText size={24}/></div><form onSubmit={upload} className="policy-form"><label>Document ID<input required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}" placeholder="e.g. TN-POL-01" value={docId} onChange={e=>setDocId(e.target.value)}/></label><label>Policy name<input required maxLength={200} placeholder="e.g. Prepaid plans" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Policy file<input key={inputKey} type="file" accept=".pdf,.md,.txt" required onChange={e=>setFile(e.target.files?.[0] || null)}/></label><button className="primary" disabled={busy || !backendReady}><UploadCloud size={16}/>{busy ? 'Processing…' : 'Upload policy'}</button></form><p className="policy-hint">Maximum 5 MB and 100 PDF pages. Scanned PDFs need OCR first. Uploaded policies are searchable by all signed-in users; relevant excerpts may be sent to the configured AI provider.</p>{message && <p className="policy-message" role="status">{message}</p>}{policies.length > 0 && <div className="policy-list">{policies.map(p=><div key={p.docId}><span><strong>{p.title}</strong><small>{p.docId} · {p.filename} · {p.passages} passages</small></span><span className="policy-actions"><span>v{p.version}</span><button type="button" aria-label={`Remove ${p.title}`} title="Remove policy" disabled={busy} onClick={() => remove(p)}><Trash2 size={15}/></button></span></div>)}</div>}</section>;
}
