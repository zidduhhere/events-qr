"""Read the registration workbook using Python's standard library (no pip setup)."""
import sys, zipfile, xml.etree.ElementTree as E, re, json, hashlib, collections
path=sys.argv[1];z=zipfile.ZipFile(path);ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
strings=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
rels={e.attrib['Id']:e.attrib['Target'] for e in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))};records=[];summary=[]
for sheet in E.fromstring(z.read('xl/workbook.xml')).find('m:sheets',ns):
 name=sheet.attrib['name']
 if name=='Export Summary':continue
 target=rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']];p=target.lstrip('/') if target.startswith('/') else 'xl/'+target
 for row in E.fromstring(z.read(p)).findall('m:sheetData/m:row',ns):
  cells={}
  for c in row.findall('m:c',ns):
   v=c.find('m:v',ns);inline=c.find('m:is',ns);value=v.text if v is not None else ''.join(inline.itertext()) if inline is not None else ''
   if c.attrib.get('t')=='s':value=strings[int(value)]
   cells[re.sub(r'\d','',c.attrib['r'])]=value or ''
  if name=='Summary':
   if cells.get('C','').isdigit():summary.append({'category':cells.get('A'), 'count':int(cells['C']), 'meals':[int(cells[k]) for k in 'DEF']})
   continue
  if int(row.attrib['r'])<5 or cells.get('A')=='TOTAL' or not cells.get('A'):continue
  if any(cells.get(k) not in ('0','1') for k in 'GHI'):raise ValueError('Invalid meal flags at '+name+':'+row.attrib['r'])
  records.append(dict(registration=cells['A'].strip(),name=cells['B'].strip(),hospital=cells.get('C',''),phone=cells.get('D',''),category=cells.get('E',''),foodRequirement=cells.get('F',''),meals=[int(cells[k]) for k in 'GHI'],sheet=name,row=int(row.attrib['r'])))
ids=[r['registration'] for r in records]
if len(ids)!=len(set(ids)):raise ValueError('Duplicate registration numbers')
for group in summary:
 rows=records if group['category']=='TOTAL ALL CATEGORIES' else [r for r in records if r['category']==group['category']]
 if len(rows)!=group['count'] or [sum(r['meals'][i] for r in rows) for i in range(3)]!=group['meals']:raise ValueError('Summary mismatch: '+group['category'])
print(json.dumps({'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest(),'records':records,'summary':summary},ensure_ascii=False))
