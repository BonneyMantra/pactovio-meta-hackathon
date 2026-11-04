// Static content for the landing page. The worked example is Rax Tech International (Chennai) and the
// Kurinji Commercial Bank RFP; figures come from its Company Brain and a real proposal run on 4 Nov 2026.
const SI = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/${slug}.svg`;

// `core` = the three connections the agent is built around.
export const CONNECTORS = [
  { name: 'HubSpot', role: 'Products, prices and deal outcomes', slug: 'hubspot', brand: '#FF7A59', core: true },
  { name: 'Google Drive', role: 'Every past proposal', slug: 'googledrive', brand: '#1FA463', core: true },
  { name: 'Gmail', role: 'RFQs as they arrive', slug: 'gmail', brand: '#EA4335', core: true },
  { name: 'Outlook', role: 'Email', text: 'Outlook', brand: '#0A64AD' },
  { name: 'Slack', role: 'Chat', slug: 'slack', brand: '#4A154B' },
  { name: 'Microsoft Teams', role: 'Chat', text: 'Teams', brand: '#5059C9' },
  { name: 'Salesforce', role: 'CRM', slug: 'salesforce', brand: '#00A1E0' },
  { name: 'Dropbox', role: 'Files', slug: 'dropbox', brand: '#0061FF' },
  { name: 'Google Calendar', role: 'Calendar', slug: 'googlecalendar', brand: '#4285F4' },
  { name: 'Outlook Calendar', role: 'Calendar', text: 'Outlook', brand: '#0A64AD' },
  { name: 'Jira', role: 'Projects', slug: 'jira', brand: '#0052CC' },
  { name: 'Asana', role: 'Projects', slug: 'asana', brand: '#F06A6A' },
  { name: 'DocuSign', role: 'Signing', text: 'DocuSign', brand: '#4C00FF' },
  { name: 'QuickBooks', role: 'Accounting', slug: 'quickbooks', brand: '#2CA01C' },
  { name: 'Xero', role: 'Accounting', slug: 'xero', brand: '#13B5EA' },
].map((c) => ({ ...c, src: c.slug ? SI(c.slug) : null }));

export const MODELS = [
  { name: 'Muse Spark 1.3', role: 'Reads every PDF and RFQ, learns the house style, writes the proposal', text: 'Spark' },
  { name: 'Muse Wonder 1.0', role: 'Orchestrates the bid from RFQ to finished document', text: 'Wonder' },
  { name: 'SAM 3.1', role: 'Segments the branch floor plan so every device lands in the right room', text: 'SAM' },
  { name: 'Muse Image 1.0', role: 'Draws the concept visual, always labelled as generated', text: 'Image' },
  { name: 'Muse Voice Transcribe', role: 'Takes an RFQ by voice in the chat', text: 'Voice' },
].map((m) => ({ ...m, src: null }));

export const AGENTS = [
  { name: 'MCP server', role: 'POST /mcp · tenders, verdicts, quotes as tools', text: 'MCP' },
  { name: 'REST API', role: '/v1 with workspace API keys', text: 'API' },
  { name: 'Webhooks', role: 'Signed events when a proposal is ready', text: 'Hooks' },
  { name: 'Calendar feed', role: 'Bid deadlines as an ICS feed', text: 'ICS' },
].map((a) => ({ ...a, src: null }));

// The story, one step per item: each swaps the answer panel. [n] marks become citation chips.
export const CAPS = [
  { t: 'Build the company profile', q: 'Who are we, as a bidder?', a: 'Rax Tech International, Chennai, since 2000: electronic security and e-surveillance systems for banks and ATM networks, designed and built in-house. I read <b>rax-tech.com</b> [1] and you confirmed the profile.', src: ['W'], act: 'Confirm the company profile' },
  { t: 'Import the catalogue from HubSpot', q: 'What do we sell, and at what price?', a: '<b>67 products</b> with SKUs, INR prices and images, imported from HubSpot [1]. 49 are made by Rax; the rest are bought-out items and services.', src: ['H'], act: 'Open the catalogue' },
  { t: 'Learn from every past proposal', q: 'How often do we win?', a: 'I read all <b>45 proposals</b> in the Drive folder “Rax Proposals” [1] and matched each one to its HubSpot deal [2]: 20 won, 16 lost, 9 open, a <b>56%</b> win rate. Median deal ₹32.7 lakh.', src: ['D', 'H'], act: 'Open the Company Brain' },
  { t: 'Learn the house style', q: 'How do we write a proposal?', a: 'Nine sections, always in the same order, opening with a thank-you for the RFQ [1]. Payment 40% advance, 50% on delivery, 10% on commissioning; validity 60 days; AMC 10% of hardware a year [2]. Every rule cites at least two proposals.', src: ['D'], act: 'Review the house style' },
  { t: 'Read the RFQ with page citations', q: 'What does Kurinji Commercial Bank want?', a: 'E-surveillance, intrusion alarms and safe-room access for <b>120 ATMs and 18 branches</b> across Tamil Nadu and Karnataka [1]. Bid due 24 Nov, EMD ₹12 lakh [2]. Section 4.3 asks for SecureLink v2, Tamil and Kannada voice prompts and 72-hour battery backup [3].', src: ['G', 'P'], act: 'Open the requirement list' },
  { t: 'Decide go or no-go', q: 'Should we bid?', a: '<b>Bid, with conditions.</b> The catalogue and one engineering package cover 21 of 25 requirements in full [1]. We won 5 of our 7 closest past bids [2]. Gap: eligibility asks for three bank projects of 50+ sites, and only two clearly qualify [3].', src: ['P', 'D'], act: 'Approve the bid decision' },
  { t: 'Price it from your catalogue', q: 'What does it cost?', a: '<b>25 bill-of-materials lines</b> priced from your HubSpot catalogue [1], plus a 30 person-day custom-engineering package for the Section 4.3 gaps [2]. Rax’s usual 4% discount and payment terms applied [3]: <b>₹2.47 crore</b> with GST.', src: ['H', 'D'], act: 'Review the bill of materials' },
  { t: 'Place devices on the floor plan', q: 'Where does each device go in a branch?', a: 'SAM 3.1 segmented the bank’s branch drawing and I placed <b>15 devices</b> on it [1]: alarm panels, PIRs, the strong-room OTP keypad, ATM vibration sensor, cameras, edge analytics and 2-way audio.', src: ['P'], act: 'Open the floor plan' },
  { t: 'Write it in your voice', q: 'Is the proposal ready?', a: 'Ready in <b>7.7 minutes</b>: architecture, zone wiring, Gantt, a 40-row compliance matrix and a labelled concept visual [1]. <b>82 claims</b> link to the RFP page, catalogue SKU or past proposal they came from [2]. Model cost $0.41.', src: ['P', 'D'], act: 'Download the PDF' },
  { t: 'Watch the inbox', q: 'What came in overnight?', a: 'The Kurinji Bank invitation to bid, classified <b>RFQ</b>; I started the proposal automatically [1]. A CCTV discount mailer and an internal lunch email were marked <b>ignored</b> [2].', src: ['G'], act: 'Open the proposal' },
  { t: 'Find tenders and buyers', q: 'Who else should we be bidding for?', a: 'Public tenders worldwide ranked against what Rax sells and wins [1], and banks with public buying signals found by web search, each with its source link and a drafted outreach email [2]. Nothing is sent without you.', src: ['T', 'W'], act: 'Review the drafted outreach' },
];

export const MARKS = { G: ['#EA4335', 'G'], D: ['#1FA463', 'D'], P: ['#21201c', 'P'], H: ['#FF7A59', 'H'], W: ['#00759b', 'W'], T: ['#5f5e59', 'T'] };
