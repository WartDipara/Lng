"""Download pinned public source snapshots; no scraping or dictionary prose copying."""
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
LOCK = ROOT / "data/sources.lock.json"
REPOS = {
    "kyle": ("KyleBing/english-vocabulary", "master"),
    "mahavivo": ("mahavivo/english-wordlists", "master"),
    "ecdict": ("skywind3000/ECDICT", "master"),
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
                selected += [p for p in paths if p.startswith("full_line_tsv/simple/正序/") and p.endswith(".txt") and any(t in p for t in ["雅思", "GRE", "GMAT", "专四", "专八", "商务英语"])]
            elif name == "mahavivo":
                selected = [p for p in paths if p in ["CET4_edited.txt", "CET6_edited.txt", "CET_4+6_edited.txt", "COCA_20000.txt", "GRE_8000_Words.txt", "NPEE_Wordlist.txt", "TOEFL.txt", "英语专业四八级词汇表.txt", "台灣高中英文參考詞彙表.txt"]]
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

    completed = list(ThreadPoolExecutor(max_workers=5).map(download, manifest["files"]))
    manifest["files"] = completed
    LOCK.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"files": len(completed), "bytes": sum(r["bytes"] for r in completed)}))


if __name__ == "__main__":
    main()
