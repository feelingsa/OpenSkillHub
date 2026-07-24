const nameNode = document.getElementById("skillName");
const descriptionNode = document.getElementById("skillDescription");
const contentNode = document.getElementById("skillContent");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: markdown };

  const frontmatter = match[1];
  const body = markdown.slice(match[0].length);
  const meta = {};
  const lines = frontmatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;

    const key = field[1];
    let value = field[2].trim();

    if (value === ">") {
      const folded = [];
      index += 1;
      while (index < lines.length && /^\s+/.test(lines[index])) {
        folded.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      value = folded.join(" ");
    }

    meta[key] = value.replace(/^["']|["']$/g, "");
  }

  return { meta, body };
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderTable(lines) {
  const rows = lines
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    );

  return rows
    .map((cells, rowIndex) => {
      const tag = rowIndex === 0 ? "th" : "td";
      const content = cells.map((cell) => `<${tag}>${renderInline(cell)}</${tag}>`).join("");
      return `<tr>${content}</tr>`;
    })
    .join("");
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let quote = [];
  let table = [];
  let code = [];
  let inCode = false;

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    list = [];
  }

  function flushQuote() {
    if (!quote.length) return;
    html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
    quote = [];
  }

  function flushTable() {
    if (!table.length) return;
    html.push(`<table>${renderTable(table)}</table>`);
    table = [];
  }

  function flushBlocks() {
    flushParagraph();
    flushList();
    flushQuote();
    flushTable();
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushBlocks();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushBlocks();
      continue;
    }

    if (/^\|.+\|$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      table.push(line);
      continue;
    }

    flushTable();

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushQuote();
      list.push(listItem[1]);
      continue;
    }

    const quoteLine = line.match(/^\s*>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  flushBlocks();

  if (inCode) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("\n");
}

async function loadSkill() {
  try {
    const response = await fetch("./skill.md", { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    const markdown = await response.text();
    const { meta, body } = parseFrontmatter(markdown);

    nameNode.textContent = meta.name || "ppt-master";
    descriptionNode.textContent = meta.description || "No description.";
    contentNode.innerHTML = renderMarkdown(body);
  } catch (error) {
    contentNode.innerHTML = `<p>Failed to load skill.md: ${escapeHtml(error.message)}</p>`;
  }
}

loadSkill();
