const router = require('express').Router();

//로그인했는지 체크하는 미들웨어
const checkLogin = (req, res, next) => {
  //로그인했다면 유저정보가 있을 것
  if (req.user) {
    return next();
  }
  res.status(500).redirect('/login');
};

router.get('/sports', checkLogin, (req, res) => {
  res.send('스포츠 게시판');
});
router.get('/game', checkLogin, (req, res) => {
  res.send('게임 게시판');
});

module.exports = router;
