export function renderConnectionState(element, text, type = "") {
  element.textContent = text;
  element.className = `connection-state ${type}`.trim();
}
