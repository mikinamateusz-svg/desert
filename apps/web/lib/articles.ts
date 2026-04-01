import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

export interface Article {
  slug: string;
  title: string;
  date: string;   // YYYY-MM-DD
  excerpt: string;
  html: string;   // rendered body; empty string for auto-generated article
  auto: boolean;  // true = weekly price summary (not a markdown file)
}

const ARTICLES_DIR = path.join(process.cwd(), 'content', 'articles');
const AUTO_SLUG = 'tygodniowe-ceny-paliw';

export function getAutoArticleMeta(): Omit<Article, 'html'> {
  return {
    slug:    AUTO_SLUG,
    title:   '',  // rendered per-locale in the component
    date:    new Date().toISOString().split('T')[0]!,
    excerpt: '',
    auto:    true,
  };
}

export function getAllArticles(): Omit<Article, 'html'>[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [getAutoArticleMeta()];

  const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
  const editorial = files
    .map(file => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf-8');
      const { data } = matter(raw);
      return {
        slug:    data['slug'] as string,
        title:   data['title'] as string,
        date:    data['date'] instanceof Date ? data['date'].toISOString().split('T')[0]! : String(data['date']),
        excerpt: data['excerpt'] as string,
        auto:    false,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return [getAutoArticleMeta(), ...editorial];
}

export function getArticleBySlug(slug: string): Article | null {
  if (slug === AUTO_SLUG) {
    return { ...getAutoArticleMeta(), html: '', title: '' };
  }

  if (!fs.existsSync(ARTICLES_DIR)) return null;

  const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf-8');
    const { data, content } = matter(raw);
    if (data['slug'] === slug) {
      return {
        slug:    data['slug'] as string,
        title:   data['title'] as string,
        date:    data['date'] instanceof Date ? data['date'].toISOString().split('T')[0]! : String(data['date']),
        excerpt: data['excerpt'] as string,
        html:    marked(content) as string,
        auto:    false,
      };
    }
  }

  return null;
}
