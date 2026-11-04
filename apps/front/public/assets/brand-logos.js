// Real brand marks for every connector, in one place. Simple Icons glyphs (white on the brand colour)
// where the brand is in Simple Icons; the official full-colour files in /assets/brand/connectors otherwise.
// Self-contained (no ui.js import) so ui.js, ops-kit and the landing page can all use it.
export const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/';
const FILES = '/assets/brand/connectors/';

export const BRAND = {
  gmail: { slug: 'gmail', color: '#EA4335', name: 'Gmail' },
  slack: { slug: 'slack', color: '#4A154B', name: 'Slack' },
  hubspot: { slug: 'hubspot', color: '#FF7A59', name: 'HubSpot' },
  salesforce: { slug: 'salesforce', color: '#00A1E0', name: 'Salesforce' },
  googledrive: { slug: 'googledrive', color: '#1FA463', name: 'Google Drive' },
  dropbox: { slug: 'dropbox', color: '#0061FE', name: 'Dropbox' },
  googlecalendar: { slug: 'googlecalendar', color: '#4285F4', name: 'Google Calendar' },
  jira: { slug: 'jira', color: '#0052CC', name: 'Jira' },
  asana: { slug: 'asana', color: '#F06A6A', name: 'Asana' },
  quickbooks: { slug: 'quickbooks', color: '#2CA01C', name: 'QuickBooks' },
  xero: { slug: 'xero', color: '#13B5EA', name: 'Xero' },
  meta: { slug: 'meta', color: '#0081FB', name: 'Meta' },
  outlook: { file: `${FILES}outlook.svg`, name: 'Outlook' },
  outlook_calendar: { file: `${FILES}outlook.svg`, name: 'Outlook Calendar' },
  microsoft_teams: { file: `${FILES}microsoft-teams.svg`, name: 'Microsoft Teams' },
  teams: { file: `${FILES}microsoft-teams.svg`, name: 'Microsoft Teams' },
  docusign: { file: `${FILES}docusign.svg`, name: 'DocuSign', wide: true },
  composio: { file: `${FILES}composio.png`, name: 'Composio' },
  mcp: { file: `${FILES}mcp.svg`, name: 'Model Context Protocol' },
};

const el = (tag, cls, style = {}) => { const n = document.createElement(tag); if (cls) n.className = cls; Object.assign(n.style, style); return n; };

/** A square brand tile. Unknown providers fall back to a neutral tile with the provider's initials. */
export function brandTile(provider, size = 36, name = '') {
  const b = BRAND[provider];
  const tile = el('span', 'logo-tile', { width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.28)}px` });
  tile.title = name || b?.name || provider || '';
  tile.setAttribute('role', 'img');
  tile.setAttribute('aria-label', `${tile.title} logo`);
  if (b?.slug) {
    tile.style.background = b.color;
    const url = `url(${SI}${b.slug}.svg)`;
    tile.appendChild(el('span', 'logo-glyph', { width: `${Math.round(size * 0.52)}px`, height: `${Math.round(size * 0.52)}px`, WebkitMaskImage: url, maskImage: url }));
  } else if (b?.file) {
    tile.classList.add('file');
    const img = el('img', '', { width: `${Math.round(size * (b.wide ? 0.84 : 0.62))}px`, height: `${Math.round(size * 0.62)}px`, objectFit: 'contain' });
    img.src = b.file; img.alt = '';
    tile.appendChild(img);
  } else {
    tile.classList.add('neutral');
    tile.style.fontSize = `${Math.round(size * 0.36)}px`;
    tile.textContent = String(name || provider || '?').slice(0, 2);
  }
  return tile;
}

/** HTML string version for the static landing page. */
export function brandTileHTML(provider, size = 16) {
  const n = document.createElement('div');
  n.appendChild(brandTile(provider, size));
  return n.innerHTML;
}
