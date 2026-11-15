/*
 * 演示数据：复用前端 js/data.js 里的物品/用户，再补充密码、信用分、
 * 防冒领核验题和认领答题记录。真实部署时建议通过种子脚本写入 PostgreSQL。
 *
 * 同时兼容正常目录结构（server/seed.js）和 GitHub 网页上传被拍平到根目录
 * 的仓库结构（seed.js + data.js 都在根目录）。
 */
const fs = require('node:fs');
const path = require('node:path');

global.window = global.window || {};
const dataFile = ['../js/data.js', './js/data.js', './data.js', '../data.js']
  .map((rel) => path.resolve(__dirname, rel))
  .find((file) => fs.existsSync(file));
if (!dataFile) throw new Error('找不到 data.js');
require(dataFile);

const base = global.window.HDUData.makeSeed();
const PASSWORD = 'hdu1956';

const TRUST = { u1: 96, u2: 91, u3: 88, u4: 84, u5: 79 };

const QUESTIONS = {
  it_1001: [
    { q: '卡套背面是什么图案？', a: '小熊|熊' },
    { q: '卡号后四位是多少？', a: '6621' },
    { q: '卡套里还夹了什么？', a: '借阅单|图书馆单' }
  ],
  it_1002: [
    { q: '卡面姓名最后一个字是什么？', a: '强' },
    { q: '卡号后四位是多少？', a: '8821' },
    { q: '卡套是什么颜色？', a: '红|红色' }
  ],
  it_1003: [
    { q: '充电盒背面刻了什么？', a: 'ZLK' },
    { q: '左耳外壳有什么痕迹？', a: '划痕' }
  ],
  it_1004: [
    { q: '钥匙挂件是什么动物？', a: '熊' },
    { q: '一共有几把钥匙？', a: '三|3' }
  ],
  it_1005: [
    { q: '伞柄哪里掉漆？', a: '底部|伞柄' },
    { q: '伞套是什么颜色？', a: '浅灰|灰' }
  ],
  it_1006: [
    { q: '扉页写了谁的名字？', a: '赵一鸣' },
    { q: '书里夹了什么？', a: '复习提纲|提纲' }
  ],
  it_1007: [
    { q: '杯身贴纸写了什么？', a: '今天也要早睡|早睡' },
    { q: '杯盖是什么颜色？', a: '蓝|蓝色' }
  ],
  it_1008: [
    { q: '捡到的是哪一只耳机？', a: '右耳' },
    { q: '耳机是什么品牌？', a: '苹果|AirPods' }
  ],
  it_1009: [
    { q: '学生证上的姓名是谁？', a: '陈默' },
    { q: '学生证属于哪个学院？', a: '自动化' }
  ],
  it_1010: [
    { q: '钥匙圈是什么颜色？', a: '橙|橙色' },
    { q: '钥匙一共几把？', a: '1|一' }
  ],
  it_1011: [
    { q: '杯身是什么颜色？', a: '蓝|蓝色' },
    { q: '杯盖是什么材质？', a: '银|金属' }
  ],
  it_1012: [
    { q: '伞柄是什么材质？', a: '木|木质|木头' },
    { q: '伞面内侧有什么？', a: '补丁' }
  ]
};

const ANSWER_SETS = {
  cl_2001: [
    { q: '卡套背面是什么图案？', a: '小熊', match: 1 },
    { q: '卡号后四位是多少？', a: '6621', match: 1 },
    { q: '卡套里还夹了什么？', a: '借阅单', match: 1 }
  ],
  cl_2002: [
    { q: '充电盒背面刻了什么？', a: 'ZLK', match: 1 },
    { q: '左耳外壳有什么痕迹？', a: '划痕', match: 1 }
  ],
  cl_2003: [
    { q: '扉页写了谁的名字？', a: '赵一鸣', match: 1 },
    { q: '书里夹了什么？', a: '复习提纲', match: 1 }
  ],
  cl_2004: [
    { q: '杯盖是什么颜色？', a: '蓝色', match: 1 },
    { q: '杯身贴纸写了什么？', a: '蓝色贴纸', match: 0 }
  ]
};

const users = base.users.map((u) => ({
  ...u,
  password: PASSWORD,
  trustScore: u.trustScore || TRUST[u.id] || 80
}));

const byId = Object.fromEntries(users.map((u) => [u.id, u]));

const items = base.items.map((i) => ({
  ...i,
  contactPhone: byId[i.ownerId].phone,
  contactWechat: byId[i.ownerId].wechat,
  questions: QUESTIONS[i.id] || []
}));

const claims = base.claims.map((c) => {
  const answers = ANSWER_SETS[c.id] || [];
  const qCount = answers.length || QUESTIONS[c.itemId].length || 0;
  return {
    ...c,
    ownerId: items.find((i) => i.id === c.itemId)?.ownerId,
    message: c.answer,
    answers,
    matchCount: answers.filter((a) => a.match).length,
    questionCount: qCount,
    handoverCode: c.status === 'returned' ? '482913' : '',
    claimantConfirmed: c.status === 'returned' ? 1 : 0,
    ownerConfirmed: c.status === 'returned' ? 1 : 0
  };
});

const notifications = base.notifications.map((n) => ({ ...n, userId: 'u1' }));

module.exports = { users, items, claims, notifications, PASSWORD };
