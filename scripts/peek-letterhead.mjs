import fs from 'node:fs'; import JSZip from 'jszip';
const z = await JSZip.loadAsync(fs.readFileSync('C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/AutoSign/_config/letterhead_asi_connect.docx'));
console.log(Object.keys(z.files).join('\n'));
const doc = await z.file('word/document.xml').async('string'); console.log('\n--- document.xml length', doc.length); console.log(doc.slice(0, 3000)); console.log('...'); console.log(doc.slice(-1800));
const st = await z.file('word/styles.xml').async('string'); console.log('\n--- styles:', [...st.matchAll(/<w:style [^>]*w:styleId="([^"]+)"/g)].map(m => m[1]).join(', '));
