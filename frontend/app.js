import { createMotionScope } from "./motion/index.js";

const skillDeck = document.getElementById("skillDeck");
const connectionState = document.getElementById("connectionState");
const skillPosition = document.getElementById("skillPosition");
const prevSkill = document.getElementById("prevSkill");
const nextSkill = document.getElementById("nextSkill");
const skillModal = document.getElementById("skillModal");
const skillModalWindow = skillModal?.querySelector(".skill-modal-window");
const skillModalHero = document.getElementById("skillModalHero");
const skillModalTitle = document.getElementById("skillModalTitle");
const skillModalContent = document.getElementById("skillModalContent");
const skillStartButton = document.getElementById("skillStartButton");
let activeModalSkill = null;
let opencodeAvailable = false;
const motion = createMotionScope(document.body);
document.documentElement.dataset.gsapReady = "true";
window.addEventListener("pagehide", () => motion.revert(), { once: true });

const skillCards = [
  {
    id: "ppt-master",
    title: "ppt-master",
    tag: "PPTX",
    tone: "violet",
    preview: "./skills/ppt-master/assets/hero-preview.png",
    background: "./skills/ppt-master/assets/background.png",
    markdown: "./skills/ppt-master/skill.md",
  },
  {
    id: "drawio",
    title: "drawio",
    tag: "DIAGRAM",
    tone: "cyan",
    preview: "./skills/drawio/assets/hero-preview.png",
    background: "./skills/drawio/assets/background.png",
    markdown: "./skills/drawio/skill.md",
  },
  {
    id: "tencent-meeting-email",
    title: "tencent-meeting-email",
    tag: "MEETING",
    tone: "green",
    preview: "./skills/tencent-meeting-email/assets/hero-preview.png",
    background: "./skills/tencent-meeting-email/assets/background.png",
    markdown: "./skills/tencent-meeting-email/skill.md",
  },
  {
    id: "html-ppt-skill",
    title: "html-ppt-skill",
    tag: "SLIDES",
    tone: "orange",
    preview: "./skills/html-ppt-skill/assets/hero-preview.png",
    background: "./skills/html-ppt-skill/assets/background.png",
    markdown: "./skills/html-ppt-skill/skill.md",
  },
  {
    id: "svg-generator",
    title: "svg-generator",
    tag: "SVG",
    tone: "yellow",
    preview: "./skills/svg-generator/assets/hero-preview.png",
    background: "./skills/svg-generator/assets/background.png",
    markdown: "./skills/svg-generator/skill.md",
  },
  {
    id: "xml-diagram",
    title: "xml-diagram",
    tag: "DRAWIO XML",
    tone: "indigo",
    preview: "./skills/xml-diagram/assets/hero-preview.png",
    background: "./skills/xml-diagram/assets/background.png",
    markdown: "./skills/xml-diagram/skill.md",
  },
];
const stackSize = 16;

let wheelLocked = false;
let stackOffset = 0;
let liftedCardIndex = null;

function setConnection(text, type = "") {
  connectionState.textContent = text;
  connectionState.className = `connection-state ${type}`.trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function stripFrontmatter(markdown = "") {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function parseFrontmatter(markdown = "") {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};

  const meta = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
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
    meta[field[1]] = value.replace(/^["']|["']$/g, "");
  }
  return meta;
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownPreview(markdown = "", maxLines = 90) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let listType = "";
  let codeBlock = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let blockquote = [];
  let table = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) return;
    const tag = listType === "ol" ? "ol" : "ul";
    html.push(
      `<${tag}>${list
        .map((item) => `<li style="--list-depth:${item.depth}">${renderInline(item.text)}</li>`)
        .join("")}</${tag}>`,
    );
    list = [];
    listType = "";
  };

  const flushCodeBlock = () => {
    html.push(`<pre><code data-language="${escapeHtml(codeLanguage)}">${escapeHtml(codeBlock.join("\n"))}</code></pre>`);
    codeBlock = [];
    codeLanguage = "";
  };

  const flushBlockquote = () => {
    if (!blockquote.length) return;
    html.push(`<blockquote>${blockquote.map((item) => `<p>${renderInline(item)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  };

  const isTableDivider = (value) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value);
  const isTableRow = (value) => /^\s*\|.*\|\s*$/.test(value);
  const splitTableCells = (value) =>
    value
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const flushTable = () => {
    if (table.length < 2 || !isTableDivider(table[1])) {
      if (table.length) paragraph.push(...table.map((row) => row.trim()));
      table = [];
      return;
    }

    const headers = splitTableCells(table[0]);
    const rows = table.slice(2).map(splitTableCells);
    html.push(`
      <div class="markdown-table-wrap">
        <table>
          <thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>
          <tbody>${rows
            .map((row) => `<tr>${headers.map((_, index) => `<td>${renderInline(row[index] || "")}</td>`).join("")}</tr>`)
            .join("")}</tbody>
        </table>
      </div>
    `);
    table = [];
  };

  for (const rawLine of lines.slice(0, maxLines)) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        codeLanguage = line.trim().replace(/^```/, "").trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushBlockquote();
      flushTable();
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      flushTable();
      html.push("<hr />");
      continue;
    }

    if (isTableRow(line)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      table.push(line);
      continue;
    }

    flushTable();

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushBlockquote();
      const level = Math.min(heading[1].length, 6);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushBlockquote();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      list.push({ depth: Math.floor(listItem[1].length / 2), text: listItem[2] });
      continue;
    }

    const numberedItem = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (numberedItem) {
      flushParagraph();
      flushBlockquote();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      list.push({ depth: Math.floor(numberedItem[1].length / 2), text: numberedItem[2] });
      continue;
    }

    if (line.trim().startsWith(">")) {
      flushParagraph();
      flushList();
      blockquote.push(line.replace(/^\s*>\s?/, ""));
      continue;
    }

    flushBlockquote();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushBlockquote();
  flushTable();
  flushCodeBlock();
  return html.join("\n") || "<p>No skill document content.</p>";
}

function renderSkillMarkdown(markdown = "") {
  const lines = stripFrontmatter(markdown).split(/\r?\n/);

  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0]?.match(/^#\s+/)) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0]?.trim().startsWith(">")) {
    while (lines.length && lines[0].trim().startsWith(">")) lines.shift();
  }

  return renderMarkdownPreview(lines.join("\n").trim(), Number.POSITIVE_INFINITY);
}

function skillHeroTemplate(skill) {
  return `
    <img class="skill-card-image" src="${skill.preview}" alt="${escapeHtml(skill.title)} preview" />
  `;
}

function windowTemplate(index) {
  const skill = skillCards[index % skillCards.length];
  return `
    <article class="skill-window" data-card="${index}" data-skill="${escapeHtml(skill.id)}">
      <header class="window-bar">
        <div class="window-controls" aria-label="window controls">
          <span class="control minimize" title="minimize"></span>
          <span class="control collapse" title="collapse"></span>
          <span class="control close" title="close"></span>
        </div>
        <div class="bar-title">${escapeHtml(skill.title)}</div>
        <span class="window-tag tag-${skill.tone}">${escapeHtml(skill.tag)}</span>
      </header>

      ${skillHeroTemplate(skill)}
    </article>
  `;
}

function getStackLayout(cards) {
  return cards.length <= 8
    ? { startY: -250, gapY: 58 }
    : { startY: -372, gapY: 42 };
}

function applyStackPositions() {
  const cards = [...skillDeck.querySelectorAll(".skill-window")];
  const focusSlot = cards.length - 1;
  const { startY, gapY } = getStackLayout(cards);

  cards.forEach((card, index) => {
    const slot = (index + stackOffset + cards.length) % cards.length;
    const depth = slot / Math.max(cards.length - 1, 1);
    const isFocus = slot === focusSlot;
    const isLifted = !isFocus && index === liftedCardIndex;
    const y = startY + slot * gapY + (isFocus ? 72 : 0) + (isLifted ? -74 : 0);
    const z = -1040 + slot * 72 + (isFocus ? 190 : 0) + (isLifted ? 84 : 0);
    const x = Math.sin(index * 1.6) * 0.45;
    const scale = isFocus ? 1 : 0.78 + depth * 0.28 + (isLifted ? 0.035 : 0);
    const rotateX = isFocus ? -10 : -66 + depth * 18 + (isLifted ? 8 : 0);
    const rotateZ = (slot - focusSlot / 2) * -0.055;
    const opacity = 0.64 + depth * 0.34 + (isFocus ? 0.03 : 0) + (isLifted ? 0.08 : 0);
    const blur = Math.max(0, (1 - depth) * 0.95 - (isFocus ? 0.8 : 0));
    const brightness = isFocus ? 1.08 : 0.62 + depth * 0.36 + (isLifted ? 0.18 : 0);

    card.style.zIndex = String(20 + slot * 10 + (isFocus ? 60 : 0) + (isLifted ? 70 : 0));
    card.style.opacity = opacity.toFixed(3);
    card.style.filter = `blur(${blur.toFixed(2)}px) brightness(${brightness.toFixed(3)}) saturate(${isFocus ? 1.08 : 0.82})`;
    card.style.transform = `
      translate(-50%, -50%)
      translate3d(${x.toFixed(2)}%, ${y.toFixed(2)}px, ${z.toFixed(2)}px)
      rotateX(${rotateX.toFixed(2)}deg)
      rotateZ(${rotateZ.toFixed(2)}deg)
      scale(${scale.toFixed(3)})
    `;
    card.classList.toggle("is-focus", isFocus);
    card.classList.toggle("is-front-card", isFocus);
    card.classList.toggle("is-lifted", isLifted);
  });

  if (skillPosition) {
    skillPosition.textContent = `archive stack ${((stackOffset % stackSize) + stackSize) % stackSize + 1} / ${stackSize}`;
  }
}

function setLiftedCard(index) {
  if (liftedCardIndex === index) return;
  liftedCardIndex = index;
  skillDeck.classList.toggle("has-lifted-card", liftedCardIndex !== null);
  applyStackPositions();
}

async function handleSkillCardClick(cardIndex, card) {
  if (cardIndex === null || !card) return;
  const skill = skillCards[cardIndex % skillCards.length];
  await openSkillModal(skill, card);
}

async function openSkillModal(skill, sourceCard) {
  activeModalSkill = skill;
  skillStartButton.disabled = !opencodeAvailable;
  skillStartButton.textContent = opencodeAvailable ? "开始" : "OpenCode 离线";
  skillModalTitle.textContent = skill.title;
  skillModalHero.style.backgroundImage = `
    linear-gradient(180deg, rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.28)),
    url("${skill.preview}")
  `;
  skillModalContent.innerHTML = "<p>Loading skill.md...</p>";
  skillModal.classList.remove("is-leaving");
  skillModal.classList.add("is-open");
  skillModal.setAttribute("aria-hidden", "false");
  playModalOpenAnimation(sourceCard);

  try {
    const response = await fetch(skill.markdown, { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    const markdown = await response.text();
    skillModalContent.innerHTML = renderSkillMarkdown(markdown);
  } catch (error) {
    skillModalContent.innerHTML = `<p>Failed to load ${escapeHtml(skill.markdown)}: ${escapeHtml(error.message)}</p>`;
  }
}

function closeSkillModal() {
  if (!skillModal.classList.contains("is-open")) return;
  skillModal.classList.add("is-leaving");
  window.setTimeout(() => {
    skillModal.classList.remove("is-open", "is-leaving");
    skillModal.setAttribute("aria-hidden", "true");
    activeModalSkill = null;
  }, 220);
}

function handleSkillStart(skill) {
  if (!skill || !opencodeAvailable) return;
}

function playModalOpenAnimation(sourceCard) {
  if (!sourceCard || !skillModalWindow?.animate) return;

  const sourceRect = sourceCard.getBoundingClientRect();
  window.requestAnimationFrame(() => {
    const finalRect = skillModalWindow.getBoundingClientRect();
    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const finalCenterX = finalRect.left + finalRect.width / 2;
    const finalCenterY = finalRect.top + finalRect.height / 2;
    const scaleX = sourceRect.width / finalRect.width;
    const scaleY = sourceRect.height / finalRect.height;
    const translateX = sourceCenterX - finalCenterX;
    const translateY = sourceCenterY - finalCenterY;

    skillModalWindow.getAnimations().forEach((animation) => animation.cancel());
    skillModalHero.getAnimations().forEach((animation) => animation.cancel());
    skillModalContent.getAnimations().forEach((animation) => animation.cancel());

    skillModalWindow.animate(
      [
        {
          opacity: 0.72,
          transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
          borderRadius: "5px",
        },
        {
          opacity: 1,
          transform: "translate(0, 0) scale(1, 1)",
          borderRadius: "8px",
        },
      ],
      {
        duration: 520,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      },
    );

    skillModalHero.animate(
      [
        { opacity: 0.2, transform: "scale(1.08)", filter: "brightness(1.22) saturate(1.15)" },
        { opacity: 1, transform: "scale(1)", filter: "brightness(1) saturate(1)" },
      ],
      {
        duration: 560,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      },
    );

    skillModalContent.animate(
      [
        { opacity: 0, transform: "translateY(14px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: 360,
        delay: 170,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
  });
}

function getHoverCardIndex(event) {
  const cards = [...skillDeck.querySelectorAll(".skill-window")];
  const focusSlot = cards.length - 1;
  const { startY, gapY } = getStackLayout(cards);
  const deckRect = skillDeck.getBoundingClientRect();
  const deckCenterX = deckRect.left + deckRect.width / 2;
  const deckBaseY = deckRect.top + deckRect.height * 0.54;
  const zones = [];

  cards.forEach((card, index) => {
    const slot = (index + stackOffset + cards.length) % cards.length;
    if (slot === focusSlot) return;

    const depth = slot / Math.max(cards.length - 1, 1);
    const scale = 0.78 + depth * 0.28;
    const x = Math.sin(index * 1.6) * 0.0045 * card.offsetWidth;
    const centerY = deckBaseY + startY + slot * gapY;
    const topY = centerY - (card.offsetHeight * scale) / 2;
    const halfWidth = (card.offsetWidth * scale) / 2;

    zones.push({
      index,
      slot,
      centerX: deckCenterX + x,
      topY,
      halfWidth,
    });
  });

  const candidates = zones
    .filter((zone) => {
      const horizontalHit = Math.abs(event.clientX - zone.centerX) <= zone.halfWidth;
      const verticalHit = event.clientY >= zone.topY - 8 && event.clientY <= zone.topY + 40;
      return horizontalHit && verticalHit;
    })
    .sort((a, b) => {
      const distanceA = Math.abs(event.clientY - a.topY);
      const distanceB = Math.abs(event.clientY - b.topY);
      return distanceA - distanceB || b.slot - a.slot;
    });

  return candidates[0]?.index ?? null;
}

function renderStack() {
  skillDeck.innerHTML = Array.from({ length: stackSize }, (_, index) => windowTemplate(index)).join("");
  applyStackPositions();
}

function switchStack(direction) {
  liftedCardIndex = null;
  stackOffset += direction;
  skillDeck.classList.remove("is-switching");
  void skillDeck.offsetWidth;
  skillDeck.classList.add("is-switching");
  applyStackPositions();
}

function bindControls() {
  prevSkill?.addEventListener("click", () => switchStack(-1));
  nextSkill?.addEventListener("click", () => switchStack(1));

  skillDeck.addEventListener("pointermove", (event) => {
    setLiftedCard(getHoverCardIndex(event));
  });

  skillDeck.addEventListener("pointerleave", () => {
    setLiftedCard(null);
  });

  skillDeck.addEventListener("click", (event) => {
    const cardIndex = getHoverCardIndex(event);
    const card = cardIndex === null ? null : skillDeck.querySelector(`[data-card="${cardIndex}"]`);
    void handleSkillCardClick(cardIndex, card);
  });

  skillModal.addEventListener("click", (event) => {
    if (event.target === skillModal) closeSkillModal();
  });

  skillStartButton.addEventListener("click", () => {
    handleSkillStart(activeModalSkill);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && skillModal.classList.contains("is-open")) {
      closeSkillModal();
    }
  });

  skillDeck.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (wheelLocked || Math.abs(event.deltaY) < 10) return;
      wheelLocked = true;
      switchStack(event.deltaY > 0 ? 1 : -1);
      window.setTimeout(() => {
        wheelLocked = false;
      }, 320);
    },
    { passive: false },
  );
}

async function loadLocalSkillCatalog() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    opencodeAvailable = health?.opencode?.status === "healthy";
    setConnection(opencodeAvailable ? `${skillCards.length} SKILLS READY` : "OPENCODE OFFLINE — CATALOG AVAILABLE", opencodeAvailable ? "ok" : "error");
  } catch {
    opencodeAvailable = false;
    setConnection("SERVICE STATUS UNAVAILABLE", "error");
  }
}

async function init() {
  bindControls();
  await loadLocalSkillCatalog();
  renderStack();
}

init();
