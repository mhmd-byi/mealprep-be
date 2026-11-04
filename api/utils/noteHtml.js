const sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'h2', 'h3', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  transformTags: {
    b: 'strong',
    i: 'em',
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' })
  }
};

const ENTITIES = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#(?:39|x27);/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&']
];

const decodeEntities = (text) => ENTITIES.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);

const htmlToText = (html) => {
  const spaced = html.replace(/<\/(p|li|h2|h3)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  const stripped = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
};

const normalizeNoteBody = (rawBody, format) => {
  if (format === 'html') {
    const html = sanitizeHtml(rawBody, SANITIZE_OPTIONS).trim();
    const text = htmlToText(html);
    if (!text) return { body: '', bodyText: '', bodyFormat: 'text' };
    return { body: html, bodyText: text, bodyFormat: 'html' };
  }
  const text = rawBody.trim();
  return { body: text, bodyText: text, bodyFormat: 'text' };
};

module.exports = { normalizeNoteBody, htmlToText };
