"""Validate the seven final CSV exports and emit normalized registration data."""
import csv, hashlib, io, json, pathlib, sys
folder=pathlib.Path(sys.argv[1]); sheets={
 'Residents':'Residents','Faculties':'Faculties','Delegates':'Delegates',
 'Organising Committee':'Organising Committee','Pharma Exhibitors':'Pharma Exhibitor','Accompany':'Accompany'}
meals=['Lunch (28 Nov)','Dinner (28 Nov)','Lunch (29 Nov)'];records=[];digest=hashlib.sha256();sources=[]
def read(name):
 path=folder/(name+'-Table 1.csv');data=path.read_bytes();digest.update(path.name.encode());digest.update(b'\0');digest.update(data);sources.append({'filename':path.name,'sha256':hashlib.sha256(data).hexdigest()})
 rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))
 return rows
for sheet,category in sheets.items():
 rows=read(sheet)
 try:header=next(i for i,r in enumerate(rows) if r and r[0].strip()=='Registration Number')
 except StopIteration:raise ValueError('Missing header: '+sheet)
 expected=['Registration Number','Name','Hospital / Place','Phone Number','Category','Food Requirement']+meals
 if [v.strip() for v in rows[header]]!=expected:raise ValueError('Unexpected columns: '+sheet)
 totals=None
 for line,values in enumerate(rows[header+1:],header+2):
  if not values or not any(v.strip() for v in values):continue
  if len(values)!=9:raise ValueError(f'Invalid column count: {sheet}:{line}')
  values=[v.strip() for v in values]
  if values[0]=='TOTAL':totals=[int(v) for v in values[6:]];continue
  if not values[0] or not values[1] or len(values[1])>120:raise ValueError(f'Missing registration/name: {sheet}:{line}')
  if values[4]!=category or any(v not in ('0','1') for v in values[6:]):raise ValueError(f'Invalid category/meal flag: {sheet}:{line}')
  records.append(dict(registration=values[0],name=values[1],hospital=values[2],phone='' if values[3] in ('','—','-') else values[3],category=category,foodRequirement=values[5],meals=[int(v) for v in values[6:]],sheet=sheet,row=line))
 actual=[sum(r['meals'][i] for r in records if r['sheet']==sheet) for i in range(3)]
 if totals is not None and actual!=totals:raise ValueError('Sheet totals mismatch: '+sheet)
ids=[r['registration'].upper() for r in records]
if len(ids)!=len(set(ids)):raise ValueError('Duplicate registration numbers in final list')
rows=read('Summary');header=next(i for i,r in enumerate(rows) if r and r[0].strip()=='Category');summary=[]
for row in rows[header+1:]:
 if not row or not row[0].strip():continue
 if len(row)!=6:raise ValueError('Invalid summary row')
 group=row[0].strip();people=records if group=='TOTAL ALL CATEGORIES' else [r for r in records if r['category']==group]
 count=int(row[2]);flags=[int(v) for v in row[3:]]
 if len(people)!=count or [sum(r['meals'][i] for r in people) for i in range(3)]!=flags:raise ValueError('Summary mismatch: '+group)
 summary.append({'category':group,'count':count,'meals':flags})
if set(s['category'] for s in summary)!=set(sheets.values())|{'TOTAL ALL CATEGORIES'}:raise ValueError('Summary must contain all six categories and grand total')
print(json.dumps({'sha256':digest.hexdigest(),'records':records,'summary':summary,'sources':sources},ensure_ascii=False))
