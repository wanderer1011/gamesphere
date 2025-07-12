import express from 'express';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import cookieparser from 'cookie-parser';
import multer from 'multer';
const __dirname = dirname(fileURLToPath(import.meta.url));
const parentDirectory = join(__dirname, '..');
const saltRounds = 10;
const app = express();
const port = process.env.PORT || 3002;
const upload = multer({
  limits: {
    fileSize: 100* 1024 * 1024, 
    fieldSize: 200* 1024 * 1024 
  }
});

const db = new pg.Client({
  user: 'postgres.eedtbsbidvmugkhccwqd',
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  database: 'postgres',
  password: 'Gopi@123',
  port: 5432,
});

db.connect();

//Verifying a password
async function verifyPassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      console.error('Error verifying password:', error);
    }
}

//Hashing the Password
async function hashPassword(password) {
  try {
    const salt = await bcrypt.genSalt(saltRounds);
    const hash = await bcrypt.hash(password, salt);
    return hash; 
  } catch (error) {
    console.error('Error hashing password:', error);
  }
}




const getNestedComments = async (postId) => {
  try {
    const result = await db.query(`
      WITH RECURSIVE reply_tree AS (
        SELECT id, content, user_id, post_id, parent_id, 0 AS level
        FROM replies
        WHERE post_id = $1 AND parent_id IS NULL

        UNION ALL

        SELECT r.id, r.content, r.user_id, r.post_id, r.parent_id, t.level + 1
        FROM replies r
        INNER JOIN reply_tree t ON r.parent_id = t.id
      )
      SELECT rt.*, users.username AS user_name
      FROM reply_tree rt
      LEFT JOIN users ON rt.user_id = users.id  -- Join users table if applicable
      ORDER BY level, id;
    `, [postId]);

    const comments = result.rows;

    const buildNestedComments = (parentId) => {
      const children = comments.filter(comment => comment.parent_id === parentId);
      return children.map(comment => ({
        ...comment,
        children: buildNestedComments(comment.id) || []
      }));
    };

    const topLevelComments = buildNestedComments(null); 
    return topLevelComments;

  } catch (err) {
    throw err;
  }
};


app.use(cookieparser());
app.use(express.static(join(parentDirectory, 'css')));
app.use(express.static(join(parentDirectory, 'js')));
app.use(express.static(join(parentDirectory, 'public')));
app.use(express.static(join(parentDirectory, 'ckeditor')));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', join(parentDirectory, 'views'));  

app.use((req, res, next) => {
  if (req.cookies.auth_token) {
      req.loggedin = true;
  } else {
      req.loggedin = false;
  }
  next();
});



app.get('/home', async(req, res) => {
  const trendingQuery = `SELECT posts.*, users.username FROM posts JOIN users ON posts.id = users.id WHERE postid BETWEEN 6 AND 9 ORDER BY id DESC`;
    const { rows } = await db.query(trendingQuery);
    if (req.loggedin) {
    const token = req.cookies.auth_token;
    if (!token) {
      return res.status(401).send('Access Denied');
    }
    try {
      res.render('index', { loggedin: req.loggedin , posts: rows });
    } catch (error) {
      res.status(400).send('Invalid Token');
    }
  }else {
    res.render('index', { loggedin: req.loggedin , posts: rows});
  }
});

app.get('/login', (req, res) => {
    res.render('login', { loggedin: req.loggedin });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const queryResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
      if (queryResult.rows.length > 0) {
        const user = queryResult.rows[0];
        const match = await verifyPassword(password, user.password);
        if (match) { 
            const token = jwt.sign({ userId: user.id, username: user.username }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '30d' });
            res.cookie('auth_token', token, { httpOnly: true, expires: new Date(Date.now() + 25892000000)});
            console.log(req.cookies.auth_token);
            res.redirect('/home');
        } else {
          res.status(401).send('Invalid password');
        }
      } else {
        res.status(404).send('User not found');
      }
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).send('An error occurred');
    }
});

app.get('/register', (req, res) => {
  res.render('register', { loggedin: req.loggedin }); 
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await hashPassword(password);
  try {
    const queryResult = await db.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
    console.log('User registered');
    res.redirect('/login');
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/profile', (req, res) => {
  const token = req.cookies.auth_token; 
  if (!token) {
      return res.status(401).send('Access Denied');
  }
  try {
      const verified = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      console.log('profile_acces_try')
      console.log(verified.username);

      res.render("profile", {username: verified.username , loggedin : req.loggedin});
  } catch (error) {
      console.log(error);
      res.redirect('/login');
  }
});


app.get('/post/:postid', async (req, res) => {
  const postId = req.params.postid;
  try {
    const postQuery = `
      SELECT posts.*, users.username 
      FROM posts 
      JOIN users ON posts.id = users.id 
      WHERE posts.postid = $1
    `;
    const comments = await getNestedComments(postId);
    const { rows } = await db.query(postQuery, [postId]);
    if (rows.length > 0) {
      const post = rows[0];
      res.render('postDetail', { post: post, username: post.username, loggedin: req.loggedin ,comments: comments});
    } else {
      res.status(404).send('Post not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving post");
  }
});

app.get('/forum', (req, res) => {
    res.render('forum', { loggedin: req.loggedin });
});

app.get('/create-post/:category', (req, res) => {
  const category = req.params.category;
  res.render('create-post',{ loggedin: req.loggedin, category: category });
});

app.post('/create-post',upload.none() ,async (req, res) => {
  const { category, title, content } = req.body;
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send('Access Denied');
  }
  try {
    const verified = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const queryResult = await db.query('INSERT INTO posts (id , title , content , category) VALUES ($1, $2, $3, $4)', [verified.userId , title, content, category]);
    res.redirect('/home');
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/post/:postid/reply', async (req, res) => {
  console.log(req.body);
  const postId = req.params.postid;
  const { replyContent } = req.body;
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send('Access Denied');
  }
  try {
    const verified = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const queryResult = await db.query('INSERT INTO replies (post_id, user_id, content) VALUES ($1, $2, $3)', [postId, verified.userId, replyContent]);
    res.redirect(`/post/${postId}`);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/post/reply/:commentId', async (req, res) => {
  const { commentId } = req.params;
  const { post_id: postId } = req.query;
  const { replyContent } = req.body;
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send('Access Denied');
  }
  try {
    const verified = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const queryResult = await db.query('INSERT INTO replies (parent_id, user_id, content , post_id) VALUES ($1, $2, $3 ,$4)', [commentId, verified.userId, replyContent, postId]);
    res.redirect(`/post/${postId}`);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/forum/:categoryName', async (req, res) => {
  const categoryName = req.params.categoryName;
  const postQuery = `
      SELECT posts.*, users.username 
      FROM posts 
      JOIN users ON posts.id = users.id 
      WHERE posts.category = $1
      ORDER BY posts.postdate DESC
    `;
  try {
    const { rows: posts } = await db.query(postQuery, [categoryName]);
    res.render('categoryposts', { loggedin: req.loggedin, posts: posts , categoryName: categoryName});
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/home');
});

app.post('/search', async (req, res) => {
  const { key } = req.body; 
  const searchQuery = `
    SELECT posts.*, users.username 
    FROM posts 
    JOIN users ON posts.id = users.id 
    WHERE posts.title ILIKE $1 OR posts.content ILIKE $1
  `;
  try {
    const { rows: posts } = await db.query(searchQuery, [`%${key}%`]);
    res.render('search', { loggedin: req.loggedin, posts: posts });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/trending', async (req, res) => {
  const trendingQuery = `SELECT posts.*, users.username FROM posts JOIN users ON posts.id = users.id WHERE postid BETWEEN 5 AND 9 ORDER BY id ASC`;
  try {
    const { rows: posts } = await db.query(trendingQuery);
    res.render('trending', { loggedin: req.loggedin, posts: posts });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/latest', async (req, res) => {
  const latestQuery = `SELECT posts.*, users.username FROM posts JOIN users ON posts.id = users.id  ORDER BY postdate DESC LIMIT 10`;
  try {
    const { rows: posts } = await db.query(latestQuery);
    res.render('latest', { loggedin: req.loggedin, posts: posts });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send('Internal Server Error');
  }
});
app.listen(port, () => {
 console.log(`Server is running on port ${port}`);
});
