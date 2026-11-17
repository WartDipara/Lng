"""Download pinned public source snapshots; no scraping or dictionary prose copying."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SOURCE_RULES = json.loads((ROOT / "config/source-rules.json").read_text(encoding="utf-8"))
RAW = ROOT / "data/raw"
LOCK = ROOT / "data/sources.lock.json"
REPOS = {
    "kyle": ("KyleBing/english-vocabulary", "master"),
    "mahavivo": ("mahavivo/english-wordlists", "master"),
    "ecdict": ("skywind3000/ECDICT", "master"),
    "wordlist": ("jeremy-rifkin/Wordlist", "master"),
}


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "EngDictionary-data/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    if LOCK.exists():
        manifest = json.loads(LOCK.read_text(encoding="utf-8"))
    else:
        records = []
        for name, (repo, branch) in REPOS.items():
            tree = json.loads(get(f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1"))
            sha = tree["sha"]
            paths = [entry["path"] for entry in tree["tree"] if entry["type"] == "blob"]
            if name == "kyle":
                selected = [p for p in paths if p.endswith(".txt") and "/" not in p]
                selected += [p for p in paths if p.startswith(SOURCE_RULES["kyle"]["simpleDirectory"]) and p.endswith(".txt") and any(t in p for t in SOURCE_RULES["kyle"]["topics"])]
            elif name == "mahavivo":
                selected = [p for p in paths if p in SOURCE_RULES["mahavivo"]["files"]]
            elif name == "wordlist":
                selected = ["master.txt"]
            else:
                selected = ["ecdict.csv"]
            selected += [p for p in paths if p in ["LICENSE", "LICENSE.md", "README.md"]]
            for path in selected:
                url = f"https://raw.githubusercontent.com/{repo}/{sha}/{urllib.parse.quote(path)}"
                key = hashlib.sha256((name + "/" + path).encode()).hexdigest()[:16]
                records.append({"id": name + ":" + key, "provider": name, "repository": repo,
                                "revision": sha, "path": path, "url": url,
                                "localFile": key + Path(path).suffix})
        records += [{"id": "oewn:2025", "provider": "oewn", "revision": "2025",
                     "path": "english-wordnet-2025.xml.gz",
                     "url": "https://en-word.net/static/english-wordnet-2025.xml.gz",
                     "localFile": "english-wordnet-2025.xml.gz"},
                    {"id": "oewn:license", "provider": "oewn", "revision": "9b6aca775ae10ad3d2dc9956e8ad42a4ce1e076b",
                     "path": "LICENSE.md",
                     "url": "https://raw.githubusercontent.com/globalwordnet/english-wordnet/9b6aca775ae10ad3d2dc9956e8ad42a4ce1e076b/LICENSE.md",
                     "localFile": "oewn-LICENSE.md"}]
        manifest = {"retrievedAt": datetime.now(timezone.utc).isoformat(), "files": records}
        # Keep the inventory even if a download fails, so retries use identical revisions.
        LOCK.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    if not any(r["id"] == "oewn:princeton-license" for r in manifest["files"]):
        manifest["files"].append({"id": "oewn:princeton-license", "provider": "oewn", "revision": "9b6aca775ae10ad3d2dc9956e8ad42a4ce1e076b",
            "path": "WNDB_License.txt", "url": "https://raw.githubusercontent.com/globalwordnet/english-wordnet/9b6aca775ae10ad3d2dc9956e8ad42a4ce1e076b/WNDB_License.txt", "localFile": "oewn-WNDB_License.txt"})

    # Extend a pinned inventory without refreshing or replacing existing snapshots.
    if not any(record["provider"] == "wordlist" for record in manifest["files"]):
        repository, branch = REPOS["wordlist"]
        tree = json.loads(get(f"https://api.github.com/repos/{repository}/git/trees/{branch}?recursive=1"))
        revision = tree["sha"]
        retrieved_at = datetime.now(timezone.utc).isoformat()
        for name in ["master.txt", "README.md", "LICENSE"]:
            key = hashlib.sha256(("wordlist/" + name).encode()).hexdigest()[:16]
            manifest["files"].append({"id": "wordlist:" + key, "provider": "wordlist",
                "repository": repository, "revision": revision, "path": name,
                "url": f"https://raw.githubusercontent.com/{repository}/{revision}/{name}",
                "localFile": key + Path(name).suffix, "retrievedAt": retrieved_at})
        LOCK.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", action="append", choices=[*REPOS, "oewn"], help="Download only selected providers; retain other locked records.")
    options = parser.parse_args()

    def download(record):
        path = RAW / record["localFile"]
        data = path.read_bytes() if path.exists() else get(record["url"])
        digest = hashlib.sha256(data).hexdigest()
        if record.get("sha256") and record["sha256"] != digest:
            raise ValueError("Checksum mismatch: " + record["id"])
        if not path.exists():
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(data)
            temporary.replace(path)
        return dict(record, sha256=digest, bytes=len(data))

    selected = [record for record in manifest["files"] if not options.provider or record["provider"] in options.provider]
    with ThreadPoolExecutor(max_workers=5) as pool:
        completed = list(pool.map(download, selected))
    by_id = {record["id"]: record for record in completed}
    manifest["files"] = [by_id.get(record["id"], record) for record in manifest["files"]]
    LOCK.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"files": len(completed), "bytes": sum(r["bytes"] for r in completed)}))


if __name__ == "__main__":
    main()
