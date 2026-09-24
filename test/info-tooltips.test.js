const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');

function createPage(width, height, options = {}) {
  const documentEvents = {};
  const windowEvents = {};
  const viewportEvents = {};
  let activeButton = null;
  const body = {
    dataset: {},
    tip: null,
    appendChild(node) { this.tip = node; node.parentNode = this; },
    removeChild(node) { assert.equal(node, this.tip); this.tip = null; node.parentNode = null; }
  };
  const window = {
    innerWidth: width,
    innerHeight: height,
    addEventListener(type, handler) { (windowEvents[type] ||= []).push(handler); }
  };
  if (options.visualViewport) {
    window.visualViewport = {
      ...options.visualViewport,
      addEventListener(type, handler) { (viewportEvents[type] ||= []).push(handler); }
    };
  }
  const document = {
    body,
    getElementById() { return null; },
    addEventListener(type, handler) { (documentEvents[type] ||= []).push(handler); },
    createElement() {
      return {
        style: {},
        classList: { add() {}, remove() {} },
        setAttribute() {},
        get offsetWidth() {
          return Math.min(240, window.innerWidth - 24, Number.parseFloat(this.style.maxWidth) || Infinity);
        },
        get offsetHeight() {
          return Math.min(options.tipHeight || 70, Number.parseFloat(this.style.maxHeight) || Infinity);
        }
      };
    }
  };
  vm.runInNewContext(app, {
    document, window, EventSource: class { close() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(null) }),
    requestAnimationFrame: callback => callback(),
    setTimeout, clearTimeout, Map, console
  }, { filename: 'public/js/app.js' });

  return {
    body, window, windowEvents, viewportEvents,
    show(bounds) {
      const btn = {
        getBoundingClientRect: typeof bounds === 'function' ? bounds : () => bounds,
        getAttribute: () => 'This is a helpful card tooltip.',
        closest: () => btn
      };
      activeButton = btn;
      document.activeElement = btn;
      for (const handler of documentEvents.focusin) handler({ target: btn });
      return body.tip;
    },
    mouseout() {
      for (const handler of documentEvents.mouseout) handler({ target: activeButton, relatedTarget: null });
    },
    blur() {
      document.activeElement = null;
      for (const handler of documentEvents.focusout) handler({ target: activeButton });
    },
    fire(type, visual = false) {
      for (const handler of (visual ? viewportEvents : windowEvents)[type] || []) handler();
    }
  };
}

function rect(left, top) {
  return { left, right: left + 18, top, bottom: top + 18, width: 18, height: 18 };
}

function assertVisible(page, tip) {
  assert.ok(tip, 'tooltip exists');
  const viewport = page.window.visualViewport;
  const left = viewport ? viewport.offsetLeft : 0;
  const top = viewport ? viewport.offsetTop : 0;
  const width = viewport ? viewport.width : page.window.innerWidth;
  const height = viewport ? viewport.height : page.window.innerHeight;
  const x = Number.parseFloat(tip.style.left);
  const y = Number.parseFloat(tip.style.top);
  assert.ok(x >= left + 12, `left ${x} is inside viewport ${left}..${left + width}`);
  assert.ok(x + tip.offsetWidth <= left + width - 12, `right ${x + tip.offsetWidth} is inside viewport`);
  assert.ok(y >= top + 12, `top ${y} is inside viewport ${top}..${top + height}`);
  assert.ok(y + tip.offsetHeight <= top + height - 12, `bottom ${y + tip.offsetHeight} is inside viewport`);
}

test('tooltips on both mobile card columns stay on-screen, including 240px and 320px phones', () => {
  for (const width of [240, 280, 320, 346, 360, 390, 600, 640]) {
    const page = createPage(width, 640);
    for (const button of [rect(Math.floor(width / 2) - 24, 170), rect(width - 34, 170)]) {
      const tip = page.show(button);
      assertVisible(page, tip);
      assert.equal(Number.parseFloat(tip.style.top), button.bottom + 10, 'mobile tooltip appears below icon');
    }
  }
});

test('a focused tooltip stays visible after mouseout and closes on blur', () => {
  const page = createPage(320, 640);
  const tip = page.show(rect(140, 180));
  page.mouseout();
  assert.equal(page.body.tip, tip);
  page.blur();
  assert.equal(page.body.tip, null);
});

test('when a mobile card is near the bottom, the tooltip flips above it', () => {
  const page = createPage(320, 700);
  const button = rect(150, 652);
  const tip = page.show(button);
  assertVisible(page, tip);
  assert.equal(Number.parseFloat(tip.style.top), button.top - 10 - tip.offsetHeight);
});

test('short viewports constrain tooltip height and placement', () => {
  const page = createPage(280, 140, { tipHeight: 240 });
  const tip = page.show(rect(120, 60));
  assertVisible(page, tip);
  assert.equal(tip.offsetHeight, 116);
});

test('desktop places tips beside buttons and falls back to the left at the right edge', () => {
  const page = createPage(1200, 800);
  const leftButton = rect(160, 300);
  const rightButton = rect(1150, 300);
  const rightTip = page.show(leftButton);
  assertVisible(page, rightTip);
  assert.equal(Number.parseFloat(rightTip.style.left), leftButton.right + 10);
  const leftTip = page.show(rightButton);
  assertVisible(page, leftTip);
  assert.equal(Number.parseFloat(leftTip.style.left), rightButton.left - leftTip.offsetWidth - 10);
});

test('active tooltip repositions after rotation and disappears when its icon scrolls offscreen', () => {
  const page = createPage(900, 700);
  let button = rect(550, 180);
  page.show(() => button);
  page.window.innerWidth = 320;
  page.window.innerHeight = 568;
  button = rect(150, 180);
  page.fire('resize');
  assertVisible(page, page.body.tip);
  assert.equal(Number.parseFloat(page.body.tip.style.top), button.bottom + 10);
  button = rect(150, -300);
  page.fire('scroll');
  assert.equal(page.body.tip, null);
});

test('pinch-zoom uses the visible viewport bounds, not the page width', () => {
  const page = createPage(400, 800, { visualViewport: { width: 180, height: 260, offsetLeft: 110, offsetTop: 140 } });
  const tip = page.show(rect(170, 230));
  assertVisible(page, tip);
  assert.equal(tip.offsetWidth, 156);
  page.window.visualViewport.width = 160;
  page.fire('resize', true);
  assertVisible(page, page.body.tip);
  assert.equal(page.body.tip.offsetWidth, 136);
});
