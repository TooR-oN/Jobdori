const http = require('http');
const fs = require('fs');

const htmlPath = '/home/user/uploaded_files/Report content on Google.html';
const html = fs.readFileSync(htmlPath, 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(4000, '0.0.0.0', () => {
  console.log('Server running on port 4000');
});
