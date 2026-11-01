import fs from 'fs';
import path from 'path';

interface TestCase {
  id: string;
  category: string;
  en: string;
  hi: string;
  ta: string;
  expected_doc_id: string | null;
  expected_facts: string[];
}

interface EvalResult {
  id: string;
  category: string;
  language: string;
  query: string;
  retrieved_doc: string | null;
  hit: boolean;
  found: boolean;
  similarityScore: number;
  latencyMs: number;
}

async function runEvaluation() {
  const datasetPath = path.resolve(process.cwd(), 'evals/test_dataset.json');
  const testCases: TestCase[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

  console.log(`=======================================================`);
  console.log(` VoiceDesk Benchmark Evaluation Suite`);
  console.log(` Running ${testCases.length} test cases across 3 languages (EN, HI, TA)`);
  console.log(`=======================================================\n`);

  const languages = ['en', 'hi', 'ta'] as const;
  const results: EvalResult[] = [];

  for (const lang of languages) {
    console.log(`--- Testing Language: [${lang.toUpperCase()}] ---`);
    let hits = 0;
    let inDomainCount = 0;
    let correctRefusals = 0;
    let oodCount = 0;
    let totalLatency = 0;

    for (const testCase of testCases) {
      const query = testCase[lang];
      const isOOD = testCase.expected_doc_id === null;

      try {
        const res = await fetch('http://localhost:4000/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: query, language: lang }),
        });

        const data = await res.json() as any;
        const retrievedDoc = data.sources && data.sources[0] ? data.sources[0].docId : null;
        const hit = !isOOD && retrievedDoc === testCase.expected_doc_id;

        if (isOOD) {
          oodCount++;
          if (!data.found && data.suggestTicket) {
            correctRefusals++;
          }
        } else {
          inDomainCount++;
          if (hit) hits++;
        }

        totalLatency += data.latencyMs || 0;

        results.push({
          id: testCase.id,
          category: testCase.category,
          language: lang,
          query,
          retrieved_doc: retrievedDoc,
          hit,
          found: data.found,
          similarityScore: data.similarityScore,
          latencyMs: data.latencyMs,
        });

        const statusIcon = isOOD
          ? (!data.found ? '✅ (Refused)' : '❌ (False Positive)')
          : (hit ? '✅' : '❌');

        console.log(`[${testCase.id}] ${statusIcon} Sim: ${data.similarityScore.toFixed(2)} | Doc: ${retrievedDoc || 'None'} | Query: "${query.slice(0, 35)}..."`);
      } catch (err: any) {
        console.error(`[${testCase.id}] Error:`, err.message);
      }
    }

    const hitRate = inDomainCount > 0 ? ((hits / inDomainCount) * 100).toFixed(1) : '0';
    const refusalRate = oodCount > 0 ? ((correctRefusals / oodCount) * 100).toFixed(1) : '0';
    const avgLatency = (totalLatency / testCases.length).toFixed(1);

    console.log(`\nResults for [${lang.toUpperCase()}]:`);
    console.log(`  - Retrieval Hit Rate: ${hitRate}% (${hits}/${inDomainCount})`);
    console.log(`  - Out-of-Domain Refusal Rate: ${refusalRate}% (${correctRefusals}/${oodCount})`);
    console.log(`  - Average Latency: ${avgLatency} ms\n`);
  }

  // Save report
  const reportPath = path.resolve(process.cwd(), 'evals/benchmark_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`Benchmark report saved to ${reportPath}`);
}

runEvaluation().catch(console.error);
