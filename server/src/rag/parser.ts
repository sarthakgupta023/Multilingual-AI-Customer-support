import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { PolicyChunk } from './types';

export function loadAndChunkPolicies(policiesDir: string = config.paths.policiesDir): PolicyChunk[] {
  if (!fs.existsSync(policiesDir)) {
    console.warn(`[RAG Parser] Policies directory not found at: ${policiesDir}`);
    return [];
  }

  const files = fs.readdirSync(policiesDir).filter(f => f.endsWith('.md'));
  const chunks: PolicyChunk[] = [];

  for (const file of files) {
    const filePath = path.join(policiesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract title from the first # line
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const docTitle = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');

    // Extract Document ID
    const docIdMatch = content.match(/## Document ID:\s*([^\n\r]+)/);
    const docId = docIdMatch ? docIdMatch[1].trim() : file.replace('.md', '');

    // Split by ### sections
    const sections = content.split(/^###\s+/m);

    // If there is preamble before first ###
    if (sections[0] && sections[0].trim().length > 50) {
      chunks.push({
        id: `${file}-intro`,
        docId,
        docTitle,
        sectionTitle: 'Overview & Applicability',
        content: sections[0].trim(),
      });
    }

    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      const lines = section.split('\n');
      const sectionTitle = lines[0].trim();
      const sectionContent = lines.slice(1).join('\n').trim();

      if (sectionContent.length > 0) {
        chunks.push({
          id: `${file}-sec-${i}`,
          docId,
          docTitle,
          sectionTitle,
          content: `${docTitle} - ${sectionTitle}:\n${sectionContent}`,
        });
      }
    }
  }

  console.log(`[RAG Parser] Loaded ${files.length} policy files and generated ${chunks.length} chunks.`);
  return chunks;
}
