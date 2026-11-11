require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PRIVATE_DIR = path.join(ROOT, '..', 'elevance_private_uploads');
fs.mkdirSync(PRIVATE_DIR, { recursive: true });
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true, tableName: 'user_sessions' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'elevance.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(ROOT, { index: 'index.html', dotfiles: 'ignore', setHeaders(res, filePath) { if (filePath.startsWith(PRIVATE_DIR)) res.status(404); } }));

const clean = (v, max=4000) => String(v ?? '').trim().slice(0, max);
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'Please sign in to continue.'}); next(); }
function role(...roles){ return (req,res,next) => { if(!req.session.user || !roles.includes(req.session.user.role)) return res.status(403).json({error:'You do not have permission to do this.'}); next(); }; }
function publicUser(u){ return {id:u.id, fullName:u.full_name, email:u.email, role:u.role, companyName:u.company_name, country:u.country, cvUploaded:!!u.cv_storage_name}; }

async function initialize(){
  const schema = fs.readFileSync(path.join(ROOT,'schema.sql'),'utf8');
  await pool.query(schema);
  const adminEmail = clean(process.env.ADMIN_EMAIL,200).toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if(adminEmail && adminPassword && adminPassword !== 'CHANGE_THIS_TO_A_LONG_UNIQUE_PASSWORD'){
    const exists = await pool.query('SELECT id FROM users WHERE email=$1',[adminEmail]);
    if(!exists.rowCount){
      const hash = await bcrypt.hash(adminPassword,12);
      await pool.query('INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,\'admin\')',[clean(process.env.ADMIN_NAME,120)||'Administrator',adminEmail,hash]);
      console.log('Initial admin account created.');
    }
  }
}

app.post('/api/auth/register', asyncRoute(async(req,res)=>{
  const fullName=clean(req.body.fullName,120), email=clean(req.body.email,200).toLowerCase(), password=String(req.body.password||''), roleName=clean(req.body.role,20);
  const phone=clean(req.body.phone,40), companyName=clean(req.body.companyName,160), country=clean(req.body.country,80);
  if(fullName.length<2 || !emailOk(email) || password.length<10 || !['candidate','employer'].includes(roleName)) return res.status(400).json({error:'Enter a valid name and email, choose candidate or employer, and use a password with at least 10 characters.'});
  if(roleName==='employer' && companyName.length<2) return res.status(400).json({error:'Company name is required for employer accounts.'});
  const hash=await bcrypt.hash(password,12);
  try {
    const r=await pool.query('INSERT INTO users(full_name,email,phone,password_hash,role,company_name,country) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[fullName,email,phone,hash,roleName,companyName||null,country||null]);
    req.session.user=publicUser(r.rows[0]); res.status(201).json({user:req.session.user,message:'Your account has been created.'});
  } catch(e){ if(e.code==='23505') return res.status(409).json({error:'An account with this email already exists.'}); throw e; }
}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{
  const email=clean(req.body.email,200).toLowerCase(), password=String(req.body.password||'');
  const r=await pool.query('SELECT * FROM users WHERE email=$1',[email]);
  if(!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'Email or password is incorrect.'});
  req.session.regenerate(err=>{ if(err) return res.status(500).json({error:'Could not start a secure session.'}); req.session.user=publicUser(r.rows[0]); res.json({user:req.session.user,message:'Signed in successfully.'}); });
}));
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('elevance.sid');res.json({message:'Signed out.'});}));
app.get('/api/auth/me',(req,res)=>res.json({user:req.session.user||null}));

const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,PRIVATE_DIR),filename:(req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:5*1024*1024,files:1},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();const allowed=['.pdf','.doc','.docx'];if(!allowed.includes(ext)) return cb(new Error('Upload a PDF, DOC or DOCX file only.'));cb(null,true);}});
app.post('/api/candidate/cv',auth,role('candidate'),upload.single('cv'),asyncRoute(async(req,res)=>{
  if(!req.file) return res.status(400).json({error:'Choose a CV file first.'});
  const sig=fs.readFileSync(req.file.path).subarray(0,8).toString('hex');
  const ext=path.extname(req.file.originalname).toLowerCase();
  const valid=(ext==='.pdf' && sig.startsWith('25504446')) || (ext==='.docx' && sig.startsWith('504b0304')) || (ext==='.doc' && sig.startsWith('d0cf11e0'));
  if(!valid){fs.unlinkSync(req.file.path);return res.status(400).json({error:'The file content does not match its extension.'});}
  const old=await pool.query('SELECT cv_storage_name FROM users WHERE id=$1',[req.session.user.id]);
  await pool.query('UPDATE users SET cv_filename=$1,cv_storage_name=$2 WHERE id=$3',[path.basename(req.file.originalname),req.file.filename,req.session.user.id]);
  if(old.rows[0]?.cv_storage_name){const oldPath=path.join(PRIVATE_DIR,path.basename(old.rows[0].cv_storage_name));if(fs.existsSync(oldPath))fs.unlinkSync(oldPath);}
  req.session.user.cvUploaded=true;res.json({message:'CV uploaded securely.'});
}));

app.get('/api/jobs',asyncRoute(async(req,res)=>{const r=await pool.query("SELECT id,company_name,title,industry,employment_type,location,openings,description,created_at FROM jobs WHERE status='published' ORDER BY created_at DESC LIMIT 100");res.json({jobs:r.rows});}));
app.post('/api/jobs',auth,role('employer'),asyncRoute(async(req,res)=>{
  const b=req.body;const title=clean(b.title,160),industry=clean(b.industry,80),employment=clean(b.employmentType,40),location=clean(b.location,160),description=clean(b.description,8000),openings=Number(b.openings||1);
  if(!title||!industry||!employment||!location||description.length<20||!Number.isInteger(openings)||openings<1||openings>10000)return res.status(400).json({error:'Complete all job fields. Description must contain at least 20 characters.'});
  const u=await pool.query('SELECT company_name FROM users WHERE id=$1',[req.session.user.id]);
  const r=await pool.query('INSERT INTO jobs(employer_id,company_name,title,industry,employment_type,location,openings,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status',[req.session.user.id,u.rows[0].company_name,title,industry,employment,location,openings,description]);
  res.status(201).json({job:r.rows[0],message:'Job submitted for admin review.'});
}));
app.post('/api/jobs/:id/apply',auth,role('candidate'),asyncRoute(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:'Invalid job.'});
  const u=await pool.query('SELECT cv_storage_name FROM users WHERE id=$1',[req.session.user.id]);if(!u.rows[0]?.cv_storage_name)return res.status(400).json({error:'Upload your CV before applying.'});
  try{await pool.query('INSERT INTO applications(job_id,candidate_id,cover_note) SELECT id,$2,$3 FROM jobs WHERE id=$1 AND status=\'published\'',[id,req.session.user.id,clean(req.body.coverNote,2000)]);res.status(201).json({message:'Your application has been submitted.'});}catch(e){if(e.code==='23505')return res.status(409).json({error:'You have already applied for this job.'});throw e;}
}));
app.get('/api/dashboard',auth,asyncRoute(async(req,res)=>{
  const user=req.session.user;
  if(user.role==='candidate'){
    const r=await pool.query('SELECT a.id,a.status,a.created_at,j.title,j.company_name,j.location FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=$1 ORDER BY a.created_at DESC',[user.id]);
    return res.json({user,applications:r.rows});
  }
  if(user.role==='employer'){
    const r=await pool.query('SELECT id,title,industry,employment_type,location,openings,status,created_at FROM jobs WHERE employer_id=$1 ORDER BY created_at DESC',[user.id]);
    return res.json({user,jobs:r.rows});
  }
  res.json({user});
}));
app.get('/api/admin/overview',auth,role('admin'),asyncRoute(async(req,res)=>{
  const [counts,users,jobs,apps]=await Promise.all([
    pool.query("SELECT (SELECT COUNT(*) FROM users WHERE role='candidate') candidates,(SELECT COUNT(*) FROM users WHERE role='employer') employers,(SELECT COUNT(*) FROM jobs) jobs,(SELECT COUNT(*) FROM applications) applications"),
    pool.query('SELECT id,full_name,email,role,company_name,country,(cv_storage_name IS NOT NULL) AS cv_uploaded,created_at FROM users ORDER BY created_at DESC LIMIT 100'),
    pool.query('SELECT j.id,j.title,j.company_name,j.location,j.status,j.created_at,u.email employer_email FROM jobs j JOIN users u ON u.id=j.employer_id ORDER BY j.created_at DESC LIMIT 100'),
    pool.query('SELECT a.id,a.status,a.created_at,u.full_name candidate_name,u.email candidate_email,j.title job_title,j.company_name FROM applications a JOIN users u ON u.id=a.candidate_id JOIN jobs j ON j.id=a.job_id ORDER BY a.created_at DESC LIMIT 100')
  ]);res.json({counts:counts.rows[0],users:users.rows,jobs:jobs.rows,applications:apps.rows});
}));
app.patch('/api/admin/jobs/:id',auth,role('admin'),asyncRoute(async(req,res)=>{const status=clean(req.body.status,20);if(!['published','rejected','closed'].includes(status))return res.status(400).json({error:'Invalid job status.'});const r=await pool.query('UPDATE jobs SET status=$1 WHERE id=$2 RETURNING id,status',[status,Number(req.params.id)]);if(!r.rowCount)return res.status(404).json({error:'Job not found.'});res.json({job:r.rows[0]});}));
app.patch('/api/admin/applications/:id',auth,role('admin'),asyncRoute(async(req,res)=>{const status=clean(req.body.status,20);if(!['reviewing','shortlisted','rejected','submitted'].includes(status))return res.status(400).json({error:'Invalid application status.'});const r=await pool.query('UPDATE applications SET status=$1 WHERE id=$2 RETURNING id,status',[status,Number(req.params.id)]);if(!r.rowCount)return res.status(404).json({error:'Application not found.'});res.json({application:r.rows[0]});}));
app.get('/api/admin/cv/:candidateId',auth,role('admin'),asyncRoute(async(req,res)=>{const r=await pool.query('SELECT cv_filename,cv_storage_name FROM users WHERE id=$1 AND role=\'candidate\'',[Number(req.params.candidateId)]);if(!r.rowCount||!r.rows[0].cv_storage_name)return res.status(404).json({error:'CV not found.'});const file=path.join(PRIVATE_DIR,path.basename(r.rows[0].cv_storage_name));if(!fs.existsSync(file))return res.status(404).json({error:'CV file is unavailable.'});res.download(file,r.rows[0].cv_filename);}));

app.get('/dashboard.html',(req,res)=>res.sendFile(path.join(ROOT,'dashboard.html')));
app.get('/admin.html',(req,res)=>res.sendFile(path.join(ROOT,'admin.html')));
app.get('/health',(req,res)=>res.json({ok:true}));
app.use((err,req,res,next)=>{console.error(err);if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'CV must be 5 MB or smaller.':'File upload failed.'});if(err.message?.startsWith('Upload a PDF'))return res.status(400).json({error:err.message});res.status(500).json({error:'Something went wrong. Please try again.'});});
initialize().then(()=>app.listen(PORT,()=>console.log(`Elevance Staffing is running on port ${PORT}`))).catch(err=>{console.error('Startup failed:',err);process.exit(1);});
