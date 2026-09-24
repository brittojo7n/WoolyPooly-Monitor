import { el } from '../lib/dom.js';

function clampPages(pageState) {
  var pages = Math.max(1, Math.ceil(pageState.data.length / pageState.pageSize));
  if (pageState.page < 1) pageState.page = 1;
  if (pageState.page > pages) pageState.page = pages;
}

function renderPagedRows(pageState, bodyId, columns, emptyText, row) {
  clampPages(pageState);
  var tbody = el(bodyId);
  if (!tbody) return;
  var start = (pageState.page - 1) * pageState.pageSize;
  var records = pageState.data.slice(start, start + pageState.pageSize);
  tbody.innerHTML = records.length
    ? records.map(row).join('')
    : '<tr><td colspan="' + columns + '">' + emptyText + '</td></tr>';
}

function buildPagination(boxId, pageState, renderFn) {
  var box = el(boxId);
  if (!box) return;

  var total = pageState.data.length;
  var previousInput = box.querySelector('input');
  if (previousInput) previousInput.onblur = null;
  while (box.firstChild) box.removeChild(box.firstChild);

  var pages = Math.max(1, Math.ceil(total / pageState.pageSize));
  if (pageState.page < 1) pageState.page = 1;
  if (pageState.page > pages) pageState.page = pages;

  var start = total === 0 ? 0 : (pageState.page - 1) * pageState.pageSize + 1;
  var end = Math.min(total, pageState.page * pageState.pageSize);

  var left = document.createElement('div');
  left.className = 'page-left';
  left.textContent = 'Showing ' + start + '–' + end + ' of ' + total;

  var controls = document.createElement('div');
  controls.className = 'page-controls';

  var right = document.createElement('div');
  right.className = 'page-right';
  right.textContent = 'Page ' + pageState.page + ' of ' + pages;

  var prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'page-btn';
  prevBtn.textContent = '‹ Prev';
  prevBtn.disabled = pageState.page <= 1;
  prevBtn.addEventListener('click', function () {
    if (pageState.page > 1) {
      pageState.page--;
      renderFn();
      buildPagination(boxId, pageState, renderFn);
    }
  });
  controls.appendChild(prevBtn);

  var input = document.createElement('input');
  input.type = 'number';
  input.className = 'page-num';
  input.min = '1';
  input.max = String(pages);
  input.value = String(pageState.page);
  input.disabled = pages <= 1;
  input.setAttribute('aria-label', 'Page number');

  var commit = function () {
    var raw = input.value;
    if (raw === '') {
      input.value = String(pageState.page);
      input.blur();
      return;
    }
    var n = parseInt(raw, 10);
    if (!isFinite(n) || n < 1 || n > pages) {
      input.value = String(pageState.page);
      return;
    }
    if (n === pageState.page) return;
    pageState.page = n;
    renderFn();
    buildPagination(boxId, pageState, renderFn);
  };

  input.addEventListener('keydown', function (evt) {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      commit();
      input.blur();
    }
  });
  input.onblur = commit;
  controls.appendChild(input);

  var nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'page-btn';
  nextBtn.textContent = 'Next ›';
  nextBtn.disabled = pageState.page >= pages;
  nextBtn.addEventListener('click', function () {
    if (pageState.page < pages) {
      pageState.page++;
      renderFn();
      buildPagination(boxId, pageState, renderFn);
    }
  });
  controls.appendChild(nextBtn);

  box.appendChild(left);
  box.appendChild(controls);
  box.appendChild(right);
}

export { buildPagination, clampPages, renderPagedRows };
