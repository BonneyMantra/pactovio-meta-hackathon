// Real brand marks for every connector, in one place: the official full-colour marks, served locally from
// /assets/brand/connectors (HubSpot and QuickBooks are their Simple Icons marks in the brand colour).
// Self-contained (no ui.js import) so ui.js, ops-kit and the landing page can all use it.
export const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/';
const FILES = '/assets/brand/connectors/';

export const BRAND = {
  gmail: { file: `${FILES}gmail.svg`, name: 'Gmail' },
  slack: { file: `${FILES}slack.svg`, name: 'Slack' },
  hubspot: { file: `${FILES}hubspot.svg`, name: 'HubSpot' },
  salesforce: { file: `${FILES}salesforce.svg`, name: 'Salesforce', wide: true },
  googledrive: { file: `${FILES}google-drive.svg`, name: 'Google Drive' },
  dropbox: { file: `${FILES}dropbox.svg`, name: 'Dropbox' },
  googlecalendar: { file: `${FILES}google-calendar.svg`, name: 'Google Calendar' },
  jira: { file: `${FILES}jira.svg`, name: 'Jira' },
  asana: { file: `${FILES}asana.svg`, name: 'Asana' },
  quickbooks: { file: `${FILES}quickbooks.svg`, name: 'QuickBooks' },
  xero: { file: `${FILES}xero.svg`, name: 'Xero' },
  meta: { file: `${FILES}meta.svg`, name: 'Meta', wide: true },
  outlook: { file: `${FILES}outlook.svg`, name: 'Outlook' },
  outlook_calendar: { file: `${FILES}outlook.svg`, name: 'Outlook Calendar' },
  microsoft_teams: { file: `${FILES}microsoft-teams.svg`, name: 'Microsoft Teams' },
  teams: { file: `${FILES}microsoft-teams.svg`, name: 'Microsoft Teams' },
  docusign: { file: `${FILES}docusign.svg`, name: 'DocuSign', wide: true },
  composio: { file: `${FILES}composio.png`, name: 'Composio' },
  mcp: { file: `${FILES}mcp.svg`, name: 'Model Context Protocol' },
  google_drive: { file: `${FILES}google-drive.svg`, name: 'Google Drive' },
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
