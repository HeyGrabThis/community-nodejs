const express = require('express');
const app = express();
const { MongoClient, ObjectId } = require('mongodb');
const methodOverride = require('method-override');
//session, passport
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local');
//bcrypt
const bcrypt = require('bcrypt');
//connect-mongo
const MongoStore = require('connect-mongo');
//env
require('dotenv').config();
//multer => s3 파일 관리 용이 => 이미지 서버
const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
// socket.io
const { createServer } = require('http');
const { Server } = require('socket.io');
const server = createServer(app);
const io = new Server(server);

//passport, session설정
app.use(passport.initialize());
const sessionMiddleware = session({
  //세션 문자열 암호화할 때 쓰는 비밀번호(털리면 큰일)
  secret: process.env.SESSION_SECRET,
  //유저가 요청날릴때마다 session데이터 다시 갱신할 건지
  resave: false,
  //유저가 로그인안해도 세션 저장해둘것인지
  saveUninitialized: false,
  //세션 유효기간 설정가능 => maxAge로 밀리초 단위로 최대 기간 설정
  cookie: { maxAge: 60 * 60 * 1000 },
  //세션 db에 저장하기위해 db연결
  store: MongoStore.create({
    mongoUrl: process.env.DB_URL,
    dbName: 'forum',
  }),
});
app.use(sessionMiddleware);
app.use(passport.session());

// socket.IO와 세션 연결
io.engine.use(sessionMiddleware);

//public폴더를 사용하겠다는 등록
app.use(express.static(__dirname + '/public'));
//ejs 사용 등록
app.set('view engine', 'ejs');

//body설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//method-override설정
app.use(methodOverride('_method'));

//몽고db 설정
//database.js에서 가져오기 => 아예 db자체를 다른 파일로 뺄 수는 있지만 오래 걸리는 일을 빼는 것은 비효율적
const connectDB = require('./database.js');
let db;
connectDB
  .then((client) => {
    console.log('DB연결성공');
    db = client.db('forum');
    //db연결성공하면 서버 띄우기
    server.listen(process.env.PORT, () => {
      console.log('http://localhost:8080에서 서버 실행중');
    });
  })
  .catch((err) => {
    console.log(err);
  });

//multer
const s3 = new S3Client({
  //지역 서울
  region: 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'qkqajrrhtjforum1',
    key: function (요청, file, cb) {
      cb(null, Date.now().toString()); //업로드시 파일명 변경가능 => 겹치면 안돼서 시간같은거 기입하는 경우 많음
    },
  }),
});

//미들웨어설정
//현재시간 콘솔에 출력해주는 미들웨어
const sendTime = (req, res, next) => {
  let nowDate = new Date();
  console.log(nowDate);
  next();
};
// /list로 시작하는 모든 api에는 sendTime미들웨어가 적용됨
app.use('/list', sendTime);

//로그인, 회원가입 빈칸 확인 미들웨어
const checkBlank = (req, res, next) => {
  if (!req.body.username) {
    return res.send('id를 입력해주세요');
  }
  if (!req.body.password) {
    return res.send('비밀번호를 입력해주세요');
  }
  next();
};

//로그인했는지 체크하는 미들웨어
// const checkLogin = (req, res, next) => {
//   //로그인했다면 유저정보가 있을 것
//   if (req.user) {
//     next();
//   }
//   res.status(500).redirect('/login');
// };

app.get('/', (req, res) => {
  // __dirname은 현채 파일 경로
  res.sendFile(__dirname + '/index.html');
});

app.get('/news', (req, res) => {
  //news로 접속하면 db에 데이터 저장해보기
  // db.collection('post').insertOne({ title: 'news' });
  res.send('오늘 비옴');
});

//db에서 데이터 가져오기
app.get('/list', async (req, res) => {
  //collection의 모든 document를 출력
  let result = await db.collection('post').find().toArray();
  // console.log(result);
  // res.send(result);
  //ejs파일 랜더하고 데이터 보내기(오브젝트 자료형으로 보내야함)
  res.render('list.ejs', { posts: result });
});

//시간 보내보기
app.get('/time', (req, res) => {
  let nowDate = new Date();
  res.render('time.ejs', { time: nowDate });
});

// 글 작성기능 만들어보기
app.get('/write', (req, res) => {
  res.render('write.ejs');
});

app.post('/write/newpost', upload.single('img1'), async (req, res) => {
  //upload,single('img1')미들웨어를 통해 s3에 자동 업로드
  try {
    //예외 핸들링
    if (req.body.title === '') {
      res.send('제목 비었음');
    } else {
      await db.collection('post').insertOne({
        title: req.body.title,
        content: req.body.content,
        // 이미지 s3 경로도 같이 저장(파일이 있으면 경로저장 없으면 빈문자열)
        img: req.file ? req.file.location : '',
        user: req.user._id,
        username: req.user.username,
      });
      //응답을 안해주면 무한 대기. redirect로 다른 페이지로 이동 가능
      res.redirect('/list');
    }
  } catch (err) {
    console.log(err);
    //서버에러인걸 프론트쪽에 알려줌
    res.status(500).send('서버에러');
  }
});

//url파라미터
app.get('/detail/:id', async (req, res) => {
  try {
    //파라미터 이용 => 객체형태로 생겼음
    let paramId = req.params;
    // id로 특정 데이터 db에서 가져오기
    let result = await db.collection('post').findOne({
      //new ObjectId라고 적어주어야함. (위에서 임포트도 해야함)
      _id: new ObjectId(paramId.id),
    });
    // 모든 document가져옴
    // db.collection('post').find().toArray()
    // 파라미터의 문자길이와 id의 길이가 같을 때 null이 result에 입력됨
    if (result === null) {
      return res.status(404).send('잘못된 url');
    }
    let comment = await db
      .collection('comment')
      .find({
        post: new ObjectId(paramId.id),
      })
      .toArray();

    res.render('detail.ejs', { data: result, comment: comment });
  } catch (err) {
    console.log(err);
    res.status(404).send('잘못된 url');
  }
});

// 수정하기
app.get('/edit/:id', async (req, res) => {
  //detail페이지와 비슷하게
  try {
    let paramId = req.params;
    let result = await db.collection('post').findOne({
      _id: new ObjectId(paramId.id),
    });
    if (result === null) {
      res.status(404).send('잘못된 url');
    }
    res.render('edit.ejs', { data: result });
  } catch (err) {
    console.log(err);
    res.status(404).send('잘못된 url');
  }
});
// method-override로 form태그임에도 불구하고 put으로 바꿈
app.put('/edit/update', async (req, res) => {
  console.log(req.body);
  try {
    //예외 핸들링
    if (req.body.title === '') {
      res.send('제목 비었음');
    } else {
      await db.collection('post').updateOne(
        //id를 이렇게 보내면 사실 유저쪽에서 id를 이상하게 입력할 수도 있음.(주의해야함)
        { _id: new ObjectId(req.body._id) },
        { $set: { title: req.body.title, content: req.body.content } }
      );
      //응답을 안해주면 무한 대기. redirect로 다른 페이지로 이동 가능
      res.redirect('/list');
    }
  } catch (err) {
    console.log(err);
    //서버에러인걸 프론트쪽에 알려줌
    res.status(500).send('서버에러');
  }
});

//삭제 api
app.delete('/list/delete', async (req, res) => {
  try {
    let result = await db
      .collection('post')
      //조건 두개=> 이 게시물의 id를 찾고 현재 로그인한 사람의 id가 이 글을 작성한 사람과 일치하는지
      .deleteOne({
        _id: new ObjectId(req.query.docid),
        user: new ObjectId(req.user._id),
      });
    if (result.deletedCount === 0) {
      return res.status(401).send('삭제실패');
    }
    res.status(204).send('삭제완료');
  } catch (err) {
    console.log(err);
    res.status(400).send('서버오류');
  }
});

//페이지네이션
app.get('/list/:num', async (req, res) => {
  // skip()을 쓰는 방법은 만약 건너뛰어야할게 많아지면 딜레이가 심하게 걸린다는 단점이 있음.
  let result = await db
    .collection('post')
    .find()
    .skip((req.params.num - 1) * 5)
    .limit(5)
    .toArray();
  res.render('list.ejs', { posts: result });
});

app.get('/list/next/:num', async (req, res) => {
  // skip 사용 안하고 find에 조건식 달아서 => 맨 마지막으로 본 id보다 큰 id를 가진 document가져오라고 하기
  // 단점은 [다음페이지]만 사용가능
  let result = await db
    .collection('post')
    .find({ _id: { $gt: new ObjectId(req.params.num) } })
    .limit(5)
    .toArray();
  res.render('list.ejs', { posts: result });
});

//로그인
//passport라이브러리 => 사용법이라 그냥 복붙하면됨
passport.use(
  new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
    let result = await db
      .collection('user')
      .findOne({ username: 입력한아이디 });
    if (!result) {
      return cb(null, false, { message: '아이디 DB에 없음' });
    }
    //입력한 비번을 해싱해서 db비번이랑 비교
    if (await bcrypt.compare(입력한비번, result.password)) {
      return cb(null, result);
    } else {
      return cb(null, false, { message: '비번불일치' });
    }
  })
);
//세션 만들기
passport.serializeUser((user, done) => {
  process.nextTick(() => {
    done(null, { id: user._id, username: user.username });
  });
});
// 유저쪽 쿠키를 확인하는 작업 => 이후에 유저정보를 req에 담아준다. 어디서든(이 함수 밑의) req.user로 유저정보 가져올 수 있음
// 하지만 세션쪽 유저정보를 가져오기때문에 실제 유저정보와 차이가 있을 수 있음 => id로 db에서 유저정보를 가져오는 방식으로 보완
passport.deserializeUser(async (user, done) => {
  let result = await db
    .collection('user')
    .findOne({ _id: new ObjectId(user.id) });
  //유저 비번은 삭제하기
  delete result.password;
  process.nextTick(() => {
    return done(null, result);
  });
});

app.get('/login', (req, res) => {
  res.render('login.ejs');
});

// passport사용법이라 그냥 쓰면됨
app.post('/login', checkBlank, (req, res, next) => {
  // test2, 1234 =>아이디 비번
  //유저가 보낸 아이디랑 비번 맞는지 db에 조회해서 확인 => 맞다면 세션생성
  //위의 passport로직 실현
  passport.authenticate('local', (err, user, info) => {
    //에러있을 경우
    if (err) return res.status(500).json(err);
    //유저정보없을경우 => 왜 실패했는지 message
    if (!user) return res.status(401).json(info.message);
    req.logIn(user, (err) => {
      if (err) return next(err);
      //로그인이 완료됐을 때
      res.redirect('/');
    });
  })(req, res, next);
});

app.get('/mypage', (req, res) => {
  if (req.user) {
    res.render('mypage.ejs', { user: req.user });
  } else {
    res.redirect('/');
  }
});

//회원가입
app.get('/register', (req, res) => {
  res.render('register.ejs');
});
app.post('/register', checkBlank, async (req, res) => {
  //비밀번호랑 비밀번호 확인이 같지않다면
  if (req.body.password !== req.body.confirmPassword) {
    return res.send('비밀번호가 일치하지 않습니다');
  }
  let sameUser = await db
    .collection('user')
    .findOne({ username: req.body.username });
  if (sameUser) {
    return res.send('이미 같은 유저가 존재합니다');
  }
  //비밀번호 해싱 => 암호화
  let hashedPw = await bcrypt.hash(req.body.password, 10);
  //db저장
  await db
    .collection('user')
    .insertOne({ username: req.body.username, password: hashedPw });
  res.redirect('/');
});

//shop.js에서 export한 걸 import
app.use('/shop', require('./router/shop.js'));

//board.js에서 export한 걸 import
app.use('/board/sub', require('./router/board.js'));

// 검색한 것 찾기
app.get('/search', async (req, res) => {
  const searchCondition = [
    {
      $search: {
        index: 'title_index',
        text: { query: req.query.title, path: 'title' },
      },
    },
  ];
  let result = await db
    .collection('post')
    //index이용 =>문자말고 숫자는 굳이 이렇게 안써도 됨 (이건 그냥 index사용시. search index말고)
    //aggregate => 검색조건 여러개 가능
    .aggregate(searchCondition)
    .toArray();
  res.render('search.ejs', { posts: result });
});

//detail 댓글기능
app.post('/comment', async (req, res) => {
  if (!req.body.comment || !req.body.writer || !req.body.doc) {
    return res.status(404).send('작성요망');
  }
  await db.collection('comment').insertOne({
    comment: req.body.comment,
    writer: req.body.writer,
    post: new ObjectId(req.body.doc),
  });
  res.status(200).redirect('back');
});

//채팅할 유저들 나타내는 페이지
app.get('/users', async (req, res) => {
  //로그인했는지
  if (req.user) {
    //user들 가져오기
    let result = await db
      .collection('user')
      .find({ _id: { $ne: new ObjectId(req.user._id) } })
      .toArray();
    return res.render('user_list.ejs', { users: result });
  }
  res.redirect('/login');
});

// 채팅방 리스트
app.get('/chat/list', async (req, res) => {
  if (req.user) {
    //chatRoom 컬렉션에서 users에 내 아이디가 있는 것 가져오기
    let result = await db
      .collection('chatRoom')
      .find({ users: new ObjectId(req.user._id) })
      .toArray();
    //상대 유저 id구하기
    let youId = result.map((elm) => {
      if (new ObjectId(req.user._id).toString() === elm.users[0].toString()) {
        return elm.users[1];
      } else {
        return elm.users[0];
      }
    });
    //상대 유저 username구하기
    let youName = await Promise.all(
      youId.map(async (elm) => {
        let name = await db.collection('user').findOne({ _id: elm });
        return name.username;
      })
    );

    return res.render('chatting_list.ejs', {
      data: result,
      name: youName,
      id: youId,
    });
  }
  res.redirect('/login');
});

//채팅방 입장 => 내 id와 상대 id를 통해 chatRoom에 document발행 후 채팅 내역 불러오기
app.get('/chat/:id', async (req, res) => {
  let paramId = req.params;
  //먼저 db 채팅방에 있는지 찾아보고 없으면 만들기
  let chatRoom = await db
    .collection('chatRoom')
    .findOne({ users: [req.user._id, new ObjectId(paramId.id)] });
  if (chatRoom) {
    // console.log(chatRoom._id);
    //이 채팅방 아이디를 통해 chat콜렉션에서 주고받은 대화 가져와서 집어넣기, 채팅방 고유 id, 유저 id같이 보내기
    return res.render('chatting_room.ejs', {
      chatRoomId: chatRoom._id,
      userId: req.user._id,
    });
  } else {
    let date = new Date();
    let chatRoom2 = await db.collection('chatRoom').insertOne({
      createdAt: date,
      users: [req.user._id, new ObjectId(paramId.id)],
    });
    //만든 채팅방 document id, 유저 id같이 보내기
    res.render('chatting_room.ejs', {
      chatRoomId: chatRoom2._id,
      userId: req.user._id,
    });
  }
});

// 웹소켓 연결할 때 특정 코드 실행
io.on('connection', (socket) => {
  //현재 로그인중인 유저정보 알기 가능
  const session = socket.request.session;
  //'age'라는 데이터가 왔을 때 실행할 함수
  socket.on('age', (data) => {
    // console.log('유저가 보낸 data', data);
    //서버가 모든유저에게 데이터 보내고 싶을 때
    // socket.emit('name', 'hong');
  });
  //특정 유저들에게만 데이터를 보낼때 => room사용
  socket.on('ask-join', (data) => {
    // 특정 room에 join하고 싶다고 보낸 유저를 join시켜줌
    socket.join(data);
  });
  //전송버튼으로 누른 data수신
  socket.on('message', (data) => {
    //특정 room에 있는 사람에게만 메시지 다시 전송
    io.to(data.room).emit('broadcast', {
      msg: data.msg,
      id: session.passport.user.id,
      username: session.passport.user.username,
    });
  });
});

//로그인 했는지, 정보가 누구인지 확인
app.get('/userId', async (req, res) => {
  if (req.user) {
    return res.send(req.user._id);
  }
  res.redirect('/login');
});
