const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { getPopupModeView } = require('../../popup/popup-mode.js');

test('popup never presents sidebar as edge mode', () => {
  assert.deepEqual(getPopupModeView('float'), {
    floatPressed: true,
    edgePressed: false,
    tip: '自由悬浮窗可拖动、缩放，移出后可收起为恢复圆点。',
  });
  assert.deepEqual(getPopupModeView('edge'), {
    floatPressed: false,
    edgePressed: true,
    tip: '贴边面板会从设置的浏览器边缘滑出，减少页面遮挡。',
  });

  const sidebar = getPopupModeView('sidebar');
  assert.equal(sidebar.floatPressed, false);
  assert.equal(sidebar.edgePressed, false);
  assert.match(sidebar.tip, /原生侧边栏/);
});

test('unknown popup modes fall back to the floating view', () => {
  assert.deepEqual(getPopupModeView('unexpected'), getPopupModeView('float'));
});

test('popup starts with a neutral mode state and loads its view model first', () => {
  const html = fs.readFileSync('popup/popup.html', 'utf8');
  assert.match(html, /id="btnModeFloat"[^>]*aria-pressed="false"/);
  assert.match(html, /id="btnModeEdge"[^>]*aria-pressed="false"/);
  assert.ok(html.indexOf('popup-mode.js') < html.indexOf('popup.js'));
});
