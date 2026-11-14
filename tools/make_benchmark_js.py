"""Bundle pipeline results (metrics only) into benchmark.js for the static site.

Usage: python3 tools/make_benchmark_js.py <results> benchmark.js
<results> is either a bundle file (all_results_<generator>.json, as in the Drive folder results_json/)
or a folder of single-dataset result files (*.json)."""
import json, glob, os, sys, math, datetime
src, out = sys.argv[1], sys.argv[2]
order = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pipeline', 'datasets.json')))
names = [d['name'] for d in (order['datasets'] if isinstance(order, dict) else order)]
if os.path.isfile(src):
    records = json.load(open(src))['results']
else:
    records = [json.load(open(f)) for f in glob.glob(os.path.join(src, '*.json'))]
res = []
for j in records:
    if j.get('schema') != 'sda-result/1.0': continue
    s = j.get('source') or {}
    j['source'] = {k: v for k, v in s.items() if k in ('uci_id', 'project_file')}  # never ship local file paths
    res.append(j)
res.sort(key=lambda j: names.index(j['dataset']) if j['dataset'] in names else 999)
gens = sorted({j.get('generator') for j in res if j.get('generator')})
def clean(o):
    if isinstance(o, float): return None if not math.isfinite(o) else round(o, 6)
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list): return [clean(v) for v in o]
    return o
data = {'generated': datetime.date.today().isoformat(), 'pipeline': 'pipeline/sda_pipeline.py', 'schema': 'sda-result/1.0',
        'generator': ', '.join(gens),
        'note': 'Computed offline by the Python pipeline (SDV, SDMetrics, scikit-learn, Anonymeter), seeded. Metrics only; no data rows.',
        'results': clean(res)}
js = ('/* Six-attack benchmark: results of pipeline/sda_pipeline.py on ' + str(len(res)) + ' public datasets (' + ', '.join(gens) + '), bundled for the browser.\n'
      '   Metrics only. No data rows. Regenerate with tools/make_benchmark_js.py after a new pipeline run. */\n'
      '(function (g) { const SDA = g.SDA = g.SDA || {}; SDA.benchmarkData = ' + json.dumps(data, separators=(',', ':'), ensure_ascii=False) + '; })(typeof window !== "undefined" ? window : globalThis);\n')
open(out, 'w').write(js); print(len(res), 'results', len(js), 'bytes')
