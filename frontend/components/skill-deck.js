export const maxVisibleStackCards = 15;

export function getStackLayout(count) {
  if (count <= 1) return { startY: 0, gapY: 0 };
  const visibleHeight = 610;
  return { startY: -Math.min(345, visibleHeight / 2), gapY: Math.min(42, visibleHeight / (count - 1)) };
}

export function getActiveCardIndex(count, offset) {
  return count ? (count - 1 - offset + count * 2) % count : null;
}

export function renderSkillDeck(element, skills, renderCard) {
  element.classList.toggle("is-single", skills.length === 1);
  if (skills.length === 0) {
    element.innerHTML = '<div class="skill-deck-empty">没有符合当前条件的 Skill</div>';
    return [];
  }

  element.innerHTML = skills.map(renderCard).join("");
  return [...element.querySelectorAll(".skill-window")];
}
