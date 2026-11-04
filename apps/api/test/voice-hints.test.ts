import { describe, expect, it } from 'vitest';
import { keywordsFromText, tidyTranscript } from '../src/lib/voice-hints';

const COVER = `KURINJI COMMERCIAL BANK REQUEST FOR PROPOSAL Integrated E-Surveillance, Intrusion Alarm and Safe-Room Access Control for 120 ATM Sites and 18 Branches across Tamil Nadu and Karnataka RFP Reference No. KCBL/ITD/PROC/2026-27/ESURV/047 Date of issue Tuesday, 3 November 2026 Issued by Information Technology Department (Procurement), Kurinji Commercial Bank Limited, Kurinji House, 14 Race Course Road, Coimbatore 641 018, Tamil Nadu Contact Mr. Sundaramoorthy Venkataraghavan, Head, Procurement (IT and Security), Kurinji Commercial Bank Limited`;

describe('voice hints', () => {
  it('takes the buyer and place names from an RFQ cover page, not document vocabulary', () => {
    const k = keywordsFromText(COVER);
    expect(k[0]).toBe('Kurinji Commercial Bank');
    expect(k).toEqual(expect.arrayContaining(['Kurinji', 'Tamil', 'Nadu', 'Karnataka', 'Coimbatore', 'Sundaramoorthy']));
    for (const w of ['Request', 'Proposal', 'Tuesday', 'November', 'Date', 'Procurement']) expect(k).not.toContain(w);
    expect(k.length).toBeLessThanOrEqual(12);
  });
  it('removes the recogniser\'s stutters at chunk joins and keeps the sentence', () => {
    expect(tidyTranscript("Hi. I'm uploading an RFP RFP from Kurinji Commercial Bank.")).toBe("Hi. I'm uploading an RFP from Kurinji Commercial Bank.");
    expect(tidyTranscript("Hi, I'm uploading an RFP fromFP from Kurinji Commercial Bank")).toBe("Hi, I'm uploading an RFP from Kurinji Commercial Bank");
    expect(tidyTranscript('Hi.Hi. I need it for 120 120 ATMs. It is all in the document..')).toBe('Hi. I need it for 120 ATMs. It is all in the document.');
    expect(tidyTranscript('Alarms for 120 ATMs and 18 branches.')).toBe('Alarms for 120 ATMs and 18 branches.');
  });
});
