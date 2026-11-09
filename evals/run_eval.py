"""Measure local retrieval and refusal behavior; does not evaluate factual accuracy."""
import asyncio
import json
import time
from pathlib import Path
from server.app.agent import answer_question

async def main():
    cases = json.loads((Path(__file__).parent / 'test_dataset.json').read_text(encoding='utf-8'))
    for lang in ('en','hi','ta'):
        hits = total = refused = ood = 0
        started = time.monotonic()
        for case in cases:
            answer = await answer_question(case[lang], lang)
            expected = case['expected_doc_id']
            if expected is None:
                ood += 1
                refused += int(not answer['found'] and answer['suggestTicket'])
            else:
                total += 1
                hits += int(bool(answer['sources']) and answer['sources'][0]['docId'] == expected)
        print(f'{lang}: first-document hits {hits}/{total}; out-of-domain refusals {refused}/{ood}; {time.monotonic()-started:.1f}s')
    print('Document hits do not measure factual answer correctness.')

if __name__ == '__main__': asyncio.run(main())
