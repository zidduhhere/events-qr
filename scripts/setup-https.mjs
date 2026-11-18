import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lanAddresses } from './network.mjs'
const folder=resolve('.certs');mkdirSync(folder,{recursive:true,mode:0o700});chmodSync(folder,0o700)
const ips=[...new Set(['127.0.0.1',...lanAddresses()])]
const file=name=>resolve(folder,name)
function run(args){const r=spawnSync('openssl',args,{stdio:'pipe'});if(r.error||r.status!==0)throw new Error('OpenSSL certificate setup failed. Ensure openssl is installed. '+(r.error?.message??r.stderr.toString()));}
if(!existsSync(file('local-ca.crt'))||!existsSync(file('local-ca-key.pem'))){
 writeFileSync(file('ca.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Tablepass Local Event CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n')
 run(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','3650','-config',file('ca.cnf'),'-keyout',file('local-ca-key.pem'),'-out',file('local-ca.crt')]);chmodSync(file('local-ca-key.pem'),0o600)
}
let valid=false
try{const c=new X509Certificate(readFileSync(file('lan-cert.pem')));valid=existsSync(file('lan-key.pem'))&&ips.every(ip=>c.checkIP(ip))&&!!c.checkHost('localhost')&&Date.parse(c.validTo)>Date.now()+7*86400000}catch{/* first setup */}
if(!valid){
 writeFileSync(file('server.cnf'),'[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Tablepass Local Event\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=@names\n[names]\nDNS.1=localhost\n'+ips.map((ip,i)=>`IP.${i+1}=${ip}`).join('\n')+'\n')
 run(['req','-new','-newkey','rsa:2048','-nodes','-config',file('server.cnf'),'-keyout',file('lan-key.pem'),'-out',file('lan.csr')]);chmodSync(file('lan-key.pem'),0o600)
 run(['x509','-req','-in',file('lan.csr'),'-CA',file('local-ca.crt'),'-CAkey',file('local-ca-key.pem'),'-CAcreateserial','-out',file('lan-cert.pem'),'-days','365','-sha256','-extfile',file('server.cnf'),'-extensions','server'])
}
console.log('Local HTTPS certificate ready. Transfer ONLY .certs/local-ca.crt to your phone and trust it. Never transfer the private key files.')
for(const ip of lanAddresses())console.log(`Phone scanner: https://${ip}:5173/scan`)
if(!lanAddresses().length)console.log('No private LAN IPv4 address detected. Connect the laptop and phone to the same Wi-Fi, then rerun npm run dev:lan.')
