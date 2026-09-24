import state from './state.js';

function el(id) {
  var node = state.elCache.get(id);
  if (!node) {
    node = document.getElementById(id);
    if (node) state.elCache.set(id, node);
  }
  return node;
}

function setText(id, txt) {
  var node = el(id);
  if (node) node.textContent = txt;
}

export { el, setText };
