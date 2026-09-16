// VeilRead — TXT 导入解析：编码检测 + 章节切分（仅在扩展上下文加载）
// 章节数组元素：{t: 标题, o: 正文起点, s: 跨度起点（含标题行）}
// 第 i 章正文 = text.slice(chs[i].o, chs[i+1] ? chs[i+1].s : text.length)
(globalThis.VeilRead = globalThis.VeilRead || {}).txt = (function () {
  'use strict';

  // 依次尝试严格解码；全部失败则退化为宽松 UTF-8
  function decode(buffer) {
    const buf = new Uint8Array(buffer);
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(buf.subarray(2));
    }
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(buf.subarray(2));
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(buf.subarray(3));
    }
    for (const enc of ['utf-8', 'gbk', 'big5']) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(buf);
      } catch (e) { /* 尝试下一种 */ }
    }
    return new TextDecoder('utf-8').decode(buf);
  }

  function clean(text) {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t　]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  const CHAPTER_RE = new RegExp(
    '^(?:' +
      '第\\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\\s*[章节回卷部集篇][^\\n]{0,50}' +
      '|(?:序章|序言|楔子|引子|尾声|终章|完本感言|后记|後記|番外|序)[^\\n]{0,30}' +
      '|Chapter[\\s\\u00a0]+\\d+[^\\n]{0,50}' +
      '|卷\\s*[0-9０-９零〇一二三四五六七八九十百千万两]+[^\\n]{0,30}' +
      ')$'
  );

  function isTitleLine(line) {
    const s = line.trim();
    if (!s || s.length > 60) return false;
    return CHAPTER_RE.test(s);
  }

  const MAX_CHAPTER = 60000;      // 超长章节二次切分
  const CHUNK = 42000;            // 无章节标记时的切块大小

  function splitChapters(text) {
    const found = [];
    let pos = 0;
    for (const line of text.split('\n')) {
      if (isTitleLine(line)) {
        found.push({ t: line.trim(), s: pos, o: pos + line.length + 1 });
      }
      pos += line.length + 1;
    }

    if (found.length === 0) {
      return chunkAll(text, 0, text.length, null);
    }

    const out = [];
    // 首个标题前若有正文，保留为“开头”
    if (found[0].s > 0 && text.slice(0, found[0].s).trim()) {
      out.push({ t: '开头', s: 0, o: 0 });
    }
    for (let i = 0; i < found.length; i++) {
      const ch = found[i];
      const end = i + 1 < found.length ? found[i + 1].s : text.length;
      if (end - ch.o > MAX_CHAPTER) {
        for (const c of chunkAll(text, ch.o, end, ch.t)) out.push(c);
      } else {
        out.push(ch);
      }
    }
    return out;
  }

  // 把 [start,end) 切成若干块；baseTitle 存在时标题为 “baseTitle (n)”，否则取块首行
  function chunkAll(text, start, end, baseTitle) {
    const chunks = [];
    let s = start;
    let n = 1;
    while (s < end) {
      let e = Math.min(s + CHUNK, end);
      if (e < end) {
        const nl = text.lastIndexOf('\n', e);
        if (nl > s + CHUNK / 2) e = nl + 1;
      }
      const block = text.slice(s, e);
      let title, o = s;
      if (baseTitle) {
        title = `${baseTitle} (${n})`;
      } else {
        const firstLine = block.split('\n', 1)[0].trim();
        if (firstLine && firstLine.length <= 30) {
          title = firstLine;
          const nl = block.indexOf('\n');
          o = nl >= 0 ? s + nl + 1 : e; // 正文从第二行开始，避免与标题重复
        } else {
          title = `片段 ${n}`;
        }
      }
      chunks.push({ t: title, s, o });
      s = e;
      n++;
    }
    if (!chunks.length) chunks.push({ t: baseTitle || '正文', s: start, o: start });
    return chunks;
  }

  function titleFromFilename(name) {
    return (name || '未命名')
      .replace(/\.(txt|text)$/i, '')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .trim()
      .slice(0, 60) || '未命名';
  }

  // buffer: ArrayBuffer；返回可直接入库的 meta + text
  function importFile(filename, buffer) {
    const raw = decode(buffer);
    const text = clean(raw);
    if (!text.trim()) throw new Error('文件内容为空');
    const chapters = splitChapters(text);
    const meta = {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: titleFromFilename(filename),
      size: text.length,
      addedAt: Date.now(),
      lastOpenAt: Date.now(),
      chapterCount: chapters.length,
      chapters,
    };
    return { meta, text };
  }

  return { decode, importFile, splitChapters, titleFromFilename };
})();
