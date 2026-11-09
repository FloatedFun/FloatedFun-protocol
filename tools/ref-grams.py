"""Build tools/ref-grams.json: sha1 hashes of every lowercase word 2-gram found in the reference site's
visible HTML text and in the prose string literals of its page chunks. Hashes only, no reference copy is stored."""
import re, glob, json, hashlib, sys
R = sys.argv[1]
h = open(R + '/../ref.html', encoding='utf8').read()
b = h[h.find('<body'):]
b = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<svg[\s\S]*?</svg>', ' ', b)
chunks = [re.sub(r'<[^>]+>', ' \n ', b)]
for f in [R + '/13mtx4yjp1shf.js', R + '/437c8oxevdvux.js']:
    c = open(f, encoding='utf8').read()
    for m in re.finditer(r'"([A-Za-z$][^"\x5c]{12,300})"', c):
        s = m.group(1)
        if s.count(' ') >= 2 and re.fullmatch(r"[A-Za-z0-9 ,.'’$:;!?&%()/+-]+", s) and not re.search(r'[a-z][A-Z]{2}|-\w+-|\bflex\b|\bpx-|\bsize-', s):
            chunks.append(s)
words_sets = []
for t in chunks:
    for seg in re.split(r'[\n.!?;:|]+', t):
        w = re.findall(r"[a-z$']+", seg.lower())
        words_sets.append(w)
g = set()
for w in words_sets:
    for a, b2 in zip(w, w[1:]): g.add(hashlib.sha1((a + ' ' + b2).encode()).hexdigest()[:12])
json.dump(sorted(g), open('tools/ref-grams.json', 'w'))
print(len(g), 'hashed bigrams')
if len(sys.argv) > 2:
    s = set()
    for w in words_sets:
        for a, b2 in zip(w, w[1:]): s.add(a + ' ' + b2)
    print(sorted(s))
