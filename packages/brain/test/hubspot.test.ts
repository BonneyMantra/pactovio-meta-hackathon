import { describe, expect, it } from 'vitest';
import { inferFamily, mapHubspotProduct, toMinor } from '../src';

describe('HubSpot product mapping', () => {
  it('maps a full record to INR minor units with image and page url', () => {
    const it = mapHubspotProduct({ id: '9012', properties: { name: 'Rax Alarm Panel 8/4 Zone', hs_sku: 'rt-ap-84', description: 'Panel', price: '18,500.50', hs_product_type: 'inventory',
      hs_url: 'https://rax-tech.com/p/ap-84', hs_images: 'https://cdn.rax-tech.com/ap-84.jpg;https://cdn.rax-tech.com/ap-84-b.jpg' } });
    expect(it).toMatchObject({ external_id: '9012', sku: 'RT-AP-84', unit_price_minor: 1850050, currency: 'INR', family: 'Alarm and intrusion',
      image_url: 'https://cdn.rax-tech.com/ap-84.jpg', page_url: 'https://rax-tech.com/p/ap-84' });
  });
  it('falls back to a stable SKU and skips records without name or price', () => {
    expect(mapHubspotProduct({ id: '7', properties: { name: 'Gateway 4G', price: '9000' } })?.sku).toBe('HS-7');
    expect(mapHubspotProduct({ id: '8', properties: { name: '', price: '1' } })).toBeNull();
    expect(mapHubspotProduct({ id: '9', properties: { name: 'No price' } })).toBeNull();
  });
  it('infers category from SKU then name', () => {
    expect(inferFamily('RT-EVA-G0', 'x')).toBe('Edge video analytics');
    expect(inferFamily('ZZ-1', 'Temperature and humidity sensor')).toBe('Cold-chain IoT');
    expect(inferFamily('ZZ-2', 'Unknown thing')).toBe('General');
  });
  it('parses prices', () => {
    expect(toMinor('7800')).toBe(780000);
    expect(toMinor('abc')).toBeNull();
    expect(toMinor('')).toBeNull();
  });
});
