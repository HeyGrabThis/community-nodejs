const router = require('express').Router();

const connectDB = require('../database.js');
let db;
connectDB
  .then((client) => {
    console.log('DB연결성공');
    db = client.db('forum');
  })
  .catch((err) => {
    console.log(err);
  });

router.get('/shirts', (req, res) => {
  res.send('셔츠 파는 곳');
});

router.get('/pants', (req, res) => {
  res.send('바지 파는 곳');
});

module.exports = router;
