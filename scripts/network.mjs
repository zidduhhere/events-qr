import { networkInterfaces } from 'node:os'
export function lanAddresses() {
 return [...new Set(Object.values(networkInterfaces()).flat().filter(n => n && !n.internal && n.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)).map(n => n.address))]
}
