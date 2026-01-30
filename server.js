const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const companies = new Map();
const users = new Map();

app.post('/api/auth/register', async (req, res) => {
    try {
          const { companyName, email, password } = req.body;
          if (!companyName || !email || !password) {
                  return res.status(400).json({ error: 'Missing required fields' });
          }
          if (users.has(email)) {
                  return res.status(400).json({ error: 'Email already registered' });
          }
          const companyId = 'company_' + Date.now();
          const passwordHash = await bcrypt.hash(password, 10);
          const userId = 'user_' + Date.now();
          const user = { id: userId, email, passwordHash, companyId, role: 'owner', createdAt: new Date().toISOString() };
          companies.set(companyId, { id: companyId, name: companyName, driveConnected: false, driveEmail: null, rootFolderId: null, createdAt: new Date().toISOString() });
          users.set(email, user);
          const token = jwt.sign({ userId: user.id, companyId: user.companyId, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
          res.json({ success: true, token, user: { id: user.id, email: user.email, companyId: user.companyId, role: user.role }, company: { id: companyId, name: companyName } });
    } catch (error) {
          console.error('Register error:', error);
          res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
          const { email, password } = req.body;
          if (!email || !password) {
                  return res.status(400).json({ error: 'Email and password required' });
          }
          const user = users.get(email);
          if (!user) {
                  return res.status(401).json({ error: 'Invalid credentials' });
          }
          const passwordMatch = await bcrypt.compare(password, user.passwordHash);
          if (!passwordMatch) {
                  return res.status(401).json({ error: 'Invalid credentials' });
          }
          const company = companies.get(user.companyId);
          const token = jwt.sign({ userId: user.id, companyId: user.companyId, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
          res.json({ success: true, token, user: { id: user.id, email: user.email, companyId: user.companyId, role: user.role }, company: { id: company.id, name: company.name, driveConnected: company.driveConnected, driveEmail: company.driveEmail } });
    } catch (error) {
          console.error('Login error:', error);
          res.status(500).json({ error: 'Login failed' });
    }
});

const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try { const decoded = jwt.verify(token, process.env.JWT_SECRET); req.user = decoded; next(); }
    catch (error) { res.status(401).json({ error: 'Invalid token' }); }
};

app.post('/api/drive/connect', verifyToken, async (req, res) => {
    try {
          const { accessToken, refreshToken, driveEmail } = req.body;
          const { companyId } = req.user;
          if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
          const company = companies.get(companyId);
          if (!company) return res.status(404).json({ error: 'Company not found' });
          const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_OAUTH_CALLBACK_URL);
          oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
          const drive = google.drive({ version: 'v3', auth: oauth2Client });
          const folderResponse = await drive.files.create({ resource: { name: 'FieldShot', mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' });
          const rootFolderId = folderResponse.data.id;
          await createSubfolder(drive, rootFolderId, 'Inbox');
          await createSubfolder(drive, rootFolderId, 'Projects');
          company.driveConnected = true;
          company.driveEmail = driveEmail;
          company.rootFolderId = rootFolderId;
          company.refreshToken = Buffer.from(refreshToken).toString('base64');
          res.json({ success: true, message: 'Google Drive connected!', folderStructure: { root: 'FieldShot', subfolders: ['Inbox', 'Projects'] } });
    } catch (error) {
          console.error('Drive connect error:', error);
          res.status(500).json({ error: 'Failed to connect Google Drive' });
    }
});

app.get('/api/drive/status', verifyToken, async (req, res) => {
    try {
          const { companyId } = req.user;
          const company = companies.get(companyId);
          if (!company) return res.status(404).json({ error: 'Company not found' });
          res.json({ connected: company.driveConnected, email: company.driveEmail, rootFolderId: company.rootFolderId });
    } catch (error) {
          res.status(500).json({ error: 'Failed to get drive status' });
    }
});

async function createSubfolder(drive, parentFolderId, folderName) {
    const fileMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] };
    const response = await drive.files.create({ resource: fileMetadata, fields: 'id' });
    return response.data.id;
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'FieldShot Backend is running!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ FieldShot Backend running on http://localhost:${PORT}`);
    console.log(`📁 Using Google Drive for storage`);
});

module.exports = app;
