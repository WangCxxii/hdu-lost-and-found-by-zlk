/* 杭电失物招领系统 — 演示数据与本地存储 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'hdu_lost_found_v1';
  const now = Date.now();
  const ago = (ms) => new Date(now - ms).toISOString();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  const USERS = [
    {
      id: 'u1',
      name: '郑乐凯',
      studentId: '23034112',
      college: '计算机学院',
      grade: '2023 级',
      verified: true,
      trustScore: 96,
      phone: '13800136621',
      wechat: 'zheng_lekai',
      initial: '郑',
      tone: 'blue',
      bio: '在杭电，丢过也捡过。'
    },
    {
      id: 'u2',
      name: '李知遥',
      studentId: '22041208',
      college: '电子信息学院',
      grade: '2022 级',
      verified: true,
      trustScore: 91,
      phone: '13957120836',
      wechat: 'zhiyao_hdu',
      initial: '李',
      tone: 'mint',
      bio: '图书馆常驻选手。'
    },
    {
      id: 'u3',
      name: '王思远',
      studentId: '23037215',
      college: '管理学院',
      grade: '2023 级',
      verified: true,
      trustScore: 88,
      phone: '13758221190',
      wechat: 'siyuan_w',
      initial: '王',
      tone: 'amber',
      bio: '捡到东西会原地等五分钟。'
    },
    {
      id: 'u4',
      name: '陈默',
      studentId: '21030927',
      college: '自动化学院',
      grade: '2021 级',
      verified: true,
      trustScore: 84,
      phone: '13606508841',
      wechat: 'chenmo_hdu',
      initial: '陈',
      tone: 'violet',
      bio: '羽毛球馆常客。'
    },
    {
      id: 'u5',
      name: '赵一鸣',
      studentId: '24038802',
      college: '外国语学院',
      grade: '2024 级',
      verified: false,
      trustScore: 79,
      phone: '13588872016',
      wechat: 'yiming_z',
      initial: '赵',
      tone: 'rose',
      bio: '新生，正在熟悉校园。'
    }
  ];

  const CATEGORIES = [
    { id: 'card', name: '校园卡', icon: 'card', color: '#2F6BFF' },
    { id: 'key', name: '钥匙', icon: 'key', color: '#E9A23B' },
    { id: 'tech', name: '电子产品', icon: 'headphones', color: '#7A5AF8' },
    { id: 'book', name: '书本', icon: 'book', color: '#1F9D7A' },
    { id: 'umbrella', name: '伞', icon: 'umbrella', color: '#3B82F6' },
    { id: 'other', name: '其他', icon: 'sparkles', color: '#64748B' }
  ];

  const LOCATIONS = [
    { group: '教学区', places: ['一教', '二教', '三教', '四教', '六教', '七教'] },
    { group: '图书馆', places: ['图书馆一楼', '图书馆二楼', '图书馆三楼自习区', '图书馆四楼'] },
    { group: '生活区', places: ['一食堂', '二食堂', '三食堂', '学生宿舍 1 号楼', '学生宿舍 3 号楼', '东门', '南门'] },
    { group: '运动区', places: ['体育馆', '田径场', '篮球场', '游泳馆'] },
    { group: '其他', places: ['行政楼', '校园服务中心', '其他地点'] }
  ];

  const HOT_SEARCHES = ['校园卡', 'AirPods', '钥匙', '图书馆', '雨伞', '学生证'];

  const ITEM_IMAGES = {
    cardBlue: 'assets/items/campus-card-blue.svg',
    cardWhite: 'assets/items/campus-card-white.svg',
    airpods: 'assets/items/airpods.svg',
    keys: 'assets/items/keys-bear.svg',
    umbrella: 'assets/items/umbrella.svg',
    umbrellaBlack: 'assets/items/umbrella-black.svg',
    book: 'assets/items/book.svg',
    bottle: 'assets/items/bottle.svg',
    earbuds: 'assets/items/earbuds.svg',
    studentId: 'assets/items/student-id.svg',
    keySingle: 'assets/items/key-single.svg',
    fallback: 'assets/default-item.svg'
  };

  const ITEMS = [
    {
      id: 'it_1001',
      type: 'lost',
      title: '蓝色卡套校园卡',
      category: 'card',
      location: '图书馆三楼自习区',
      occurredAt: ago(5 * HOUR),
      createdAt: ago(4 * HOUR + 20 * 60 * 1000),
      description:
        '卡套是深蓝色的，背面贴了一张小熊贴纸，卡号后四位 6621。应该是昨天下午在图书馆三楼靠窗的位置复习时落在桌上了。校园卡补办很麻烦，捡到的同学请联系我，必有重谢！',
      images: [ITEM_IMAGES.cardBlue],
      status: 'active',
      ownerId: 'u1',
      views: 86,
      urgent: true,
      contactVisibility: 'masked',
      highlights: ['深蓝色卡套', '背面小熊贴纸', '卡号尾号 6621']
    },
    {
      id: 'it_1002',
      type: 'found',
      title: '一张校园卡，姓名王**',
      category: 'card',
      location: '二教 108',
      occurredAt: ago(2 * HOUR),
      createdAt: ago(1 * HOUR + 45 * 60 * 1000),
      description:
        '在二教 108 最后一排捡到一张校园卡，卡面照片是男生，姓名王**，已经交到二教一楼值班室，请失主带上学生证去领取。',
      images: [ITEM_IMAGES.cardWhite],
      status: 'active',
      ownerId: 'u2',
      views: 54,
      contactVisibility: 'masked',
      highlights: ['二教 108', '已交值班室', '姓名王**']
    },
    {
      id: 'it_1003',
      type: 'lost',
      title: 'AirPods Pro（充电盒有刻字）',
      category: 'tech',
      location: '六教 201',
      occurredAt: ago(1 * DAY + 3 * HOUR),
      createdAt: ago(1 * DAY + 2 * HOUR),
      description:
        '白色 AirPods Pro，充电盒背面刻了「ZLK」三个字母，左耳有一道很浅的划痕。上周四晚自习后不见了，可能落在六教 201 或走廊。耳机不值钱，但里面的歌单很重要，拜托捡到的同学联系我。',
      images: [ITEM_IMAGES.airpods],
      status: 'active',
      ownerId: 'u3',
      views: 132,
      urgent: false,
      contactVisibility: 'masked',
      highlights: ['充电盒刻字 ZLK', '左耳轻微划痕', '白色']
    },
    {
      id: 'it_1004',
      type: 'found',
      title: '钥匙串，挂了一只小熊',
      category: 'key',
      location: '一食堂东门',
      occurredAt: ago(1 * DAY + 6 * HOUR),
      createdAt: ago(1 * DAY + 5 * HOUR),
      description:
        '一串钥匙，大概三四把，挂着一个棕色小熊玩偶。在一食堂东门共享单车停车区捡到的，暂时放在一食堂一楼服务台，失主可以描述一下钥匙数量来认领。',
      images: [ITEM_IMAGES.keys],
      status: 'active',
      ownerId: 'u2',
      views: 67,
      contactVisibility: 'masked',
      highlights: ['棕色小熊挂件', '三到四把钥匙', '一食堂服务台']
    },
    {
      id: 'it_1005',
      type: 'found',
      title: '深蓝色折叠伞',
      category: 'umbrella',
      location: '行政楼大厅',
      occurredAt: ago(2 * DAY + 2 * HOUR),
      createdAt: ago(2 * DAY + 1 * HOUR),
      description:
        '深蓝色折叠伞，伞柄有一点掉漆，伞套是浅灰色的。今天下午雨停后一直放在行政楼一楼大厅的伞架上，我顺手带到了值班室。请失主描述伞柄细节。',
      images: [ITEM_IMAGES.umbrella],
      status: 'active',
      ownerId: 'u4',
      views: 41,
      contactVisibility: 'masked',
      highlights: ['深蓝色', '伞柄掉漆', '浅灰伞套']
    },
    {
      id: 'it_1006',
      type: 'lost',
      title: '《线性代数》第六版',
      category: 'book',
      location: '三教 305',
      occurredAt: ago(4 * DAY),
      createdAt: ago(3 * DAY + 20 * HOUR),
      description:
        '同济版《线性代数》第六版，扉页写了名字和班级，书里夹着一张复习提纲。上周三在三教 305 上完高数课忘在桌洞里了。已经找回，谢谢帮忙转发的同学！',
      images: [ITEM_IMAGES.book],
      status: 'returned',
      ownerId: 'u5',
      views: 73,
      contactVisibility: 'masked',
      highlights: ['同济第六版', '扉页有名字', '夹复习提纲']
    },
    {
      id: 'it_1007',
      type: 'lost',
      title: '银色保温杯（500ml）',
      category: 'other',
      location: '体育馆看台',
      occurredAt: ago(3 * DAY + 4 * HOUR),
      createdAt: ago(3 * DAY + 3 * HOUR),
      description:
        '银色不锈钢保温杯，杯盖是蓝色的，杯身贴了一张「今天也要早睡」的贴纸。上周日在体育馆看台看比赛时忘拿了，杯子里还有半杯水。',
      images: [ITEM_IMAGES.bottle],
      status: 'active',
      ownerId: 'u1',
      views: 38,
      contactVisibility: 'masked',
      highlights: ['蓝色杯盖', '早睡贴纸', '500ml']
    },
    {
      id: 'it_1008',
      type: 'found',
      title: '白色无线耳机（右耳）',
      category: 'tech',
      location: '一教 402',
      occurredAt: ago(4 * DAY + 2 * HOUR),
      createdAt: ago(4 * DAY + 1 * HOUR),
      description:
        '在一教 402 靠窗座位捡到一只白色无线耳机（右耳），看起来是某品牌半入耳式，充电仓不在。已放在一教值班室，请失主说明品牌和耳机上的小记号。',
      images: [ITEM_IMAGES.earbuds],
      status: 'active',
      ownerId: 'u4',
      views: 95,
      contactVisibility: 'masked',
      highlights: ['仅右耳', '白色半入耳', '一教值班室']
    },
    {
      id: 'it_1009',
      type: 'found',
      title: '学生证（陈*）',
      category: 'card',
      location: '体育馆',
      occurredAt: ago(5 * DAY),
      createdAt: ago(4 * DAY + 22 * HOUR),
      description:
        '体育馆看台捡到一本学生证，姓陈，自动化学院。已经联系到失主并归还，感谢大家帮忙转发。',
      images: [ITEM_IMAGES.studentId],
      status: 'returned',
      ownerId: 'u3',
      views: 61,
      contactVisibility: 'masked',
      highlights: ['自动化学院', '姓陈', '已归还']
    },
    {
      id: 'it_1010',
      type: 'lost',
      title: '宿舍钥匙（单把）',
      category: 'key',
      location: '东门共享单车区',
      occurredAt: ago(5 * DAY + 3 * HOUR),
      createdAt: ago(5 * DAY + 2 * HOUR),
      description:
        '一把银色宿舍钥匙，钥匙圈是橙色的。在东门还共享单车的时候从口袋里掉了，可能落在车筐里。有捡到的同学麻烦联系我，谢谢！',
      images: [ITEM_IMAGES.keySingle],
      status: 'active',
      ownerId: 'u5',
      views: 29,
      contactVisibility: 'masked',
      highlights: ['银色单把', '橙色钥匙圈', '东门单车区']
    },
    {
      id: 'it_1011',
      type: 'found',
      title: '蓝色保温杯',
      category: 'other',
      location: '四教 207',
      occurredAt: ago(6 * DAY),
      createdAt: ago(5 * DAY + 21 * HOUR),
      description:
        '四教 207 讲台上遗留一个蓝色保温杯，杯身有细闪，杯盖是银色。已交给四教一楼管理员，请失主自行前往认领。',
      images: [ITEM_IMAGES.bottle],
      status: 'active',
      ownerId: 'u4',
      views: 22,
      contactVisibility: 'masked',
      highlights: ['蓝色细闪', '银色杯盖', '四教管理员处']
    },
    {
      id: 'it_1012',
      type: 'lost',
      title: '黑色长柄雨伞',
      category: 'umbrella',
      location: '图书馆一楼',
      occurredAt: ago(7 * DAY),
      createdAt: ago(6 * DAY + 20 * HOUR),
      description:
        '黑色长柄雨伞，伞柄是木质的，伞面内侧有一小块补丁。上周五放在图书馆一楼伞架，晚上闭馆时忘记拿了。',
      images: [ITEM_IMAGES.umbrellaBlack],
      status: 'active',
      ownerId: 'u2',
      views: 34,
      contactVisibility: 'masked',
      highlights: ['木质伞柄', '长柄', '内侧补丁']
    }
  ];

  const CLAIMS = [
    {
      id: 'cl_2001',
      itemId: 'it_1001',
      claimantId: 'u3',
      answer: '卡套背面是一只蓝色小熊贴纸，卡号后四位 6621，卡套里还夹了一张图书馆借阅单。',
      contact: '13758221190',
      status: 'pending',
      createdAt: ago(2 * HOUR),
      note: ''
    },
    {
      id: 'cl_2002',
      itemId: 'it_1003',
      claimantId: 'u1',
      answer: '充电盒背面刻了 ZLK 三个字母，左耳外壳有一道浅划痕，盒子缝隙里有一点灰。',
      contact: '13800136621',
      status: 'pending',
      createdAt: ago(20 * HOUR),
      note: ''
    },
    {
      id: 'cl_2003',
      itemId: 'it_1006',
      claimantId: 'u1',
      answer: '扉页写了「赵一鸣 外国语学院 24038802」，书里夹着一张手写复习提纲。',
      contact: '13800136621',
      status: 'returned',
      createdAt: ago(3 * DAY + 2 * HOUR),
      note: '已在三教一楼当面归还'
    },
    {
      id: 'cl_2004',
      itemId: 'it_1007',
      claimantId: 'u4',
      answer: '杯盖上有一个蓝色贴纸，杯身有「今天也要早睡」的字样。',
      contact: '13606508841',
      status: 'rejected',
      createdAt: ago(2 * DAY),
      note: '描述与实物不符'
    }
  ];

  const NOTIFICATIONS = [
    {
      id: 'nt_3001',
      type: 'claim',
      title: '你的「蓝色卡套校园卡」收到一条认领申请',
      body: '王思远 描述了卡套背面的小熊贴纸，去看看吧。',
      createdAt: ago(2 * HOUR),
      read: false,
      itemId: 'it_1001'
    },
    {
      id: 'nt_3002',
      type: 'system',
      title: '你认领的「AirPods Pro」正在等待确认',
      body: '发布者会在核对特征后与你联系，请保持手机畅通。',
      createdAt: ago(19 * HOUR),
      read: false,
      itemId: 'it_1003'
    },
    {
      id: 'nt_3003',
      type: 'return',
      title: '「线性代数」已完成归还',
      body: '感谢你让一件物品回到了主人身边。',
      createdAt: ago(3 * DAY),
      read: true,
      itemId: 'it_1006'
    },
    {
      id: 'nt_3004',
      type: 'welcome',
      title: '欢迎来到杭电失物招领系统',
      body: '完成校园身份认证后，发布与认领都会更可信。',
      createdAt: ago(6 * DAY),
      read: true,
      itemId: ''
    }
  ];

  function makeSeed() {
    return {
      version: 1,
      currentUserId: 'u1',
      users: JSON.parse(JSON.stringify(USERS)),
      items: JSON.parse(JSON.stringify(ITEMS)),
      claims: JSON.parse(JSON.stringify(CLAIMS)),
      notifications: JSON.parse(JSON.stringify(NOTIFICATIONS)),
      favorites: ['it_1004', 'it_1005'],
      drafts: [],
      feedback: [],
      settings: {
        notifyNew: true,
        notifyClaim: true,
        maskContact: true,
        haptic: true
      },
      searchHistory: ['校园卡', '图书馆'],
      createdAt: new Date().toISOString()
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeSeed();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items) || !Array.isArray(data.users)) return makeSeed();
      return data;
    } catch (err) {
      console.warn('读取本地数据失败，已使用演示数据。', err);
      return makeSeed();
    }
  }

  function save(db) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (err) {
      console.warn('保存失败', err);
      return false;
    }
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* ignore */
    }
    return makeSeed();
  }

  global.HDUData = {
    STORAGE_KEY,
    USERS,
    CATEGORIES,
    LOCATIONS,
    HOT_SEARCHES,
    ITEM_IMAGES,
    makeSeed,
    load,
    save,
    reset
  };
})(window);


