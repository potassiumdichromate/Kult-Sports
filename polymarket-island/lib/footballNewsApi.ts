// Live football news, key-less & CORS-direct via rss2json wrapping a public
// football RSS feed. Returns [] on any failure so the UI can fall back to its
// static headlines.

const FEEDS = [
  "https://feeds.bbci.co.uk/sport/football/rss.xml",
  "https://www.skysports.com/rss/12040",
];

export type NewsItem = {
  id: string;
  title: string;
  body: string;
  source: string;
  timeLabel: string;
  link?: string;
  image?: string;
};

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#x27;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relativeTime(value?: string): string {
  if (!value) return "";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type RssItem = {
  guid?: string;
  link?: string;
  title?: string;
  description?: string;
  content?: string;
  pubDate?: string;
  thumbnail?: string;
  enclosure?: { link?: string };
};

export async function fetchFootballNews(limit = 8): Promise<NewsItem[]> {
  for (const feed of FEEDS) {
    try {
      const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}&count=${limit}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const json = (await res.json()) as { status?: string; feed?: { title?: string }; items?: RssItem[] };
      if (json.status !== "ok" || !Array.isArray(json.items) || json.items.length === 0) continue;
      const source = json.feed?.title ?? "Football";
      const items = json.items
        .slice(0, limit)
        .map((item, i) => {
          const title = stripHtml(item.title ?? "");
          const body = stripHtml(item.description ?? item.content ?? "").slice(0, 170);
          return {
            id: item.guid ?? item.link ?? String(i),
            title,
            body,
            source,
            timeLabel: relativeTime(item.pubDate),
            link: item.link,
            image: item.thumbnail || item.enclosure?.link || undefined,
          };
        })
        .filter((n) => n.title);
      if (items.length > 0) return items;
    } catch {
      // try next feed
    }
  }
  return [];
}
