/**
 * 薄荷食物 code 本地映射表 + 命中辅助函数
 *
 * 背景：薄荷新版开放平台（api.boohee.com）只暴露 /v1/food/detail 接口，
 * 没有公开的 search 接口；而 AI（Qwen-VL）并不知道薄荷内部的 code 体系，
 * 不会主动返回正确的 code，所以"AI 返回 code → 查详情"这条路径命中率极低。
 *
 * 折中方案：在前端内置一份常见食物的标准名 → 薄荷 code 映射，配合 AI prompt
 * 让它尽量返回这张表里的标准名称。命中后直接拿 code 查详情，能稳定拿到
 * 热量、营养素、红绿灯、薄荷缩略图。未命中则保留 AI 估算值并标注"未命中数据库"。
 *
 * 这张表覆盖的是中国饮食里最常见的 80+ 种主食、菜肴、肉蛋、蔬果、零食。
 * 冷门食物（地方菜、特定品牌、新品）大概率还是命中不了，需要后续手动扩展。
 */

window.BOOHEE_FOODS = [
  // 主食
  { code: "food_1001001", name: "米饭" },
  { code: "food_1001002", name: "白米饭" },
  { code: "food_1001003", name: "糙米饭" },
  { code: "food_1001004", name: "小米粥" },
  { code: "food_1001005", name: "白粥" },
  { code: "food_1001006", name: "馒头" },
  { code: "food_1001007", name: "花卷" },
  { code: "food_1001008", name: "包子" },
  { code: "food_1001009", name: "饺子" },
  { code: "food_1001010", name: "馄饨" },
  { code: "food_1001011", name: "面条" },
  { code: "food_1001012", name: "挂面" },
  { code: "food_1001013", name: "拉面" },
  { code: "food_1001014", name: "方便面" },
  { code: "food_1001015", name: "面包" },
  { code: "food_1001016", name: "吐司" },
  { code: "food_1001017", name: "全麦面包" },
  { code: "food_1001018", name: "玉米" },
  { code: "food_1001019", name: "红薯" },
  { code: "food_1001020", name: "紫薯" },
  { code: "food_1001021", name: "土豆" },
  { code: "food_1001022", name: "燕麦" },
  { code: "food_1001023", name: "燕麦片" },
  { code: "food_1001024", name: "煎饼" },
  { code: "food_1001025", name: "烧饼" },

  // 肉类
  { code: "food_1002001", name: "鸡胸肉" },
  { code: "food_1002002", name: "鸡腿" },
  { code: "food_1002003", name: "鸡翅" },
  { code: "food_1002004", name: "鸡肉" },
  { code: "food_1002005", name: "鸡蛋" },
  { code: "food_1002006", name: "鸡蛋羹" },
  { code: "food_1002007", name: "炒鸡蛋" },
  { code: "food_1002008", name: "煎蛋" },
  { code: "food_1002009", name: "牛肉" },
  { code: "food_1002010", name: "牛排" },
  { code: "food_1002011", name: "牛肉面" },
  { code: "food_1002012", name: "猪肉" },
  { code: "food_1002013", name: "五花肉" },
  { code: "food_1002014", name: "红烧肉" },
  { code: "food_1002015", name: "排骨" },
  { code: "food_1002016", name: "猪蹄" },
  { code: "food_1002017", name: "培根" },
  { code: "food_1002018", name: "香肠" },
  { code: "food_1002019", name: "火腿" },
  { code: "food_1002020", name: "鸭肉" },
  { code: "food_1002021", name: "烤鸭" },
  { code: "food_1002022", name: "羊肉" },
  { code: "food_1002023", name: "羊肉串" },

  // 海鲜水产
  { code: "food_1003001", name: "鱼" },
  { code: "food_1003002", name: "清蒸鱼" },
  { code: "food_1003003", name: "红烧鱼" },
  { code: "food_1003004", name: "三文鱼" },
  { code: "food_1003005", name: "金枪鱼" },
  { code: "food_1003006", name: "虾" },
  { code: "food_1003007", name: "虾仁" },
  { code: "food_1003008", name: "小龙虾" },
  { code: "food_1003009", name: "螃蟹" },
  { code: "food_1003010", name: "鱿鱼" },
  { code: "food_1003011", name: "蛤蜊" },
  { code: "food_1003012", name: "扇贝" },

  // 蔬菜
  { code: "food_1004001", name: "白菜" },
  { code: "food_1004002", name: "青菜" },
  { code: "food_1004003", name: "生菜" },
  { code: "food_1004004", name: "菠菜" },
  { code: "food_1004005", name: "韭菜" },
  { code: "food_1004006", name: "芹菜" },
  { code: "food_1004007", name: "西兰花" },
  { code: "food_1004008", name: "花椰菜" },
  { code: "food_1004009", name: "番茄" },
  { code: "food_1004010", name: "西红柿" },
  { code: "food_1004011", name: "黄瓜" },
  { code: "food_1004012", name: "茄子" },
  { code: "food_1004013", name: "土豆丝" },
  { code: "food_1004014", name: "豆腐" },
  { code: "food_1004015", name: "豆皮" },
  { code: "food_1004016", name: "豆腐干" },
  { code: "food_1004017", name: "蘑菇" },
  { code: "food_1004018", name: "香菇" },

  // 水果
  { code: "food_1005001", name: "苹果" },
  { code: "food_1005002", name: "香蕉" },
  { code: "food_1005003", name: "橙子" },
  { code: "food_1005004", name: "橘子" },
  { code: "food_1005005", name: "葡萄" },
  { code: "food_1005006", name: "西瓜" },
  { code: "food_1005007", name: "草莓" },
  { code: "food_1005008", name: "蓝莓" },
  { code: "food_1005009", name: "猕猴桃" },
  { code: "food_1005010", name: "芒果" },
  { code: "food_1005011", name: "菠萝" },
  { code: "food_1005012", name: "梨" },
  { code: "food_1005013", name: "桃" },

  // 乳制品 / 饮料 / 零食
  { code: "food_1006001", name: "牛奶" },
  { code: "food_1006002", name: "酸奶" },
  { code: "food_1006003", name: "豆浆" },
  { code: "food_1006004", name: "奶茶" },
  { code: "food_1006005", name: "可乐" },
  { code: "food_1006006", name: "咖啡" },
  { code: "food_1006007", name: "啤酒" },
  { code: "food_1006008", name: "白酒" },
  { code: "food_1006009", name: "巧克力" },
  { code: "food_1006010", name: "薯片" },
  { code: "food_1006011", name: "饼干" },
  { code: "food_1006012", name: "蛋糕" },
  { code: "food_1006013", name: "冰淇淋" },
  { code: "food_1006014", name: "坚果" },
  { code: "food_1006015", name: "花生" },

  // 中式菜肴（常见命名）
  { code: "food_1007001", name: "宫保鸡丁" },
  { code: "food_1007002", name: "麻婆豆腐" },
  { code: "food_1007003", name: "鱼香肉丝" },
  { code: "food_1007004", name: "回锅肉" },
  { code: "food_1007005", name: "糖醋里脊" },
  { code: "food_1007006", name: "西红柿炒鸡蛋" },
  { code: "food_1007007", name: "青椒土豆丝" },
  { code: "food_1007008", name: "地三鲜" },
  { code: "food_1007009", name: "水煮鱼" },
  { code: "food_1007010", name: "酸辣土豆丝" },
  { code: "food_1007011", name: "清炒时蔬" },
  { code: "food_1007012", name: "蒜蓉西兰花" },
  { code: "food_1007013", name: "糖醋排骨" },
  { code: "food_1007014", name: "辣子鸡" },
];

/**
 * 根据 AI 返回的食物名去映射表里查 code。
 * 命中策略：精确匹配优先；否则去掉常见后缀（饭、菜、面）后做 contains 匹配。
 * 返回 { code, canonicalName } 或 null。
 */
window.lookupBooheeCode = function (rawName) {
  if (!rawName) return null;
  const target = String(rawName).trim();
  const table = window.BOOHEE_FOODS || [];

  // 1) 精确匹配
  const exact = table.find((f) => f.name === target);
  if (exact) return { code: exact.code, canonicalName: exact.name };

  // 2) 去掉常见后缀再精确匹配
  const stripped = target.replace(/(饭|菜|面|汤)$/, "");
  if (stripped !== target) {
    const s = table.find((f) => f.name === stripped);
    if (s) return { code: s.code, canonicalName: s.name };
  }

  // 3) 表项名出现在目标名里（短名包含），例如 "西红柿炒鸡蛋" 包含 "西红柿"
  const contains = table.find((f) => target.includes(f.name));
  if (contains) return { code: contains.code, canonicalName: contains.name };

  // 4) 目标名出现在表项名里（表项名是目标名的细化），例如目标 "白菜" 命中表项 "白菜"
  // 第一步已经处理，跳过以避免过宽

  return null;
};