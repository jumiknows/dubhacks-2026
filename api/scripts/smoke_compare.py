from api.market.compare_service import compare_items
from api.market.fixtures import for_query
from api.market.recall import recall_scored
from api.market.top_service import top_items
from api.market.valued import ValuedItem


def item(id, bang, trust, **kw):
    return ValuedItem(id=id, title=id, bang_per_buck=bang, trust=trust, **kw)


cheap = item("cheap", 0.9, 0.2)
trusted = item("trusted", 0.6, 0.9)
low = compare_items(cheap, trusted, 0.2)
assert low.pick == "right", low
high = compare_items(cheap, trusted, 0.95)
assert high.left.score >= high.right.score, high
out = top_items([cheap, trusted, item("c", 0.1, 1.0)], 10, 0.5)
assert out.items[0].id == "trusted", out
raw = for_query("tent", ["amazon", "ebay", "walmart"], 50)
scored = recall_scored(raw, "2 person tent", per_site=50)
assert len(scored) == 150, len(scored)
sites = {item.marketplace for item in scored}
assert sites == {"amazon", "ebay", "walmart"}
short = top_items(scored, 10, 0.5)
assert short.count == 10
print("ok", low.pick, high.left.score, out.items[0].score, short.count)
