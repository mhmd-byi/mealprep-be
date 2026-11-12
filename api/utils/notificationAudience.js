const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const DeviceToken = require('../models/deviceTokenModel');
const { getExcludedUserIds } = require('./excludedAccounts');
const { projectExhaustionDate, loadHolidayKeys } = require('./planProjection');
const { todayCalendarDateUTC, diffInCalendarDays } = require('./dateUtils');

const STATUSES = ['active', 'queued', 'ended', 'never'];
const DIETS = ['veg', 'non-veg', 'both'];
const MEAL_SLOTS = ['lunch', 'dinner', 'both'];
const OPERATORS = ['>', '<', '='];
const MAX_DAYS = 365;

const STATUS_LABELS = { active: 'Active', queued: 'Queued', ended: 'Plan ended', never: 'Never subscribed' };
const DIET_LABELS = { veg: 'Veg', 'non-veg': 'Non-veg', both: 'Flexible diet' };
const SLOT_LABELS = { lunch: 'Lunch only', dinner: 'Dinner only', both: 'Lunch and dinner' };

const onlyKnown = (value, allowed) =>
  (Array.isArray(value) ? value : []).map(String).filter((item, index, list) => allowed.includes(item) && list.indexOf(item) === index);

const nonNegativeInt = (value) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, MAX_DAYS) : null;
};

const normalizeFilter = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const mealsLeftInput = input.mealsLeft;
  const mealsLeft =
    mealsLeftInput && OPERATORS.includes(mealsLeftInput.operator) && nonNegativeInt(mealsLeftInput.value) !== null
      ? { operator: mealsLeftInput.operator, value: nonNegativeInt(mealsLeftInput.value) }
      : null;

  return {
    userIds: (Array.isArray(input.userIds) ? input.userIds : []).map(String).filter((id) => /^[a-f0-9]{24}$/i.test(id)),
    statuses: onlyKnown(input.statuses, STATUSES),
    plans: (Array.isArray(input.plans) ? input.plans : [])
      .map((item) => String(item).trim())
      .filter((item, index, list) => item.length > 0 && item.length <= 60 && list.indexOf(item) === index),
    diets: onlyKnown(input.diets, DIETS),
    mealSlots: onlyKnown(input.mealSlots, MEAL_SLOTS),
    carbTypes: (Array.isArray(input.carbTypes) ? input.carbTypes : []).map(String).filter((item) => /^[a-z0-9-]{2,40}$/.test(item)),
    pincodes: (Array.isArray(input.pincodes) ? input.pincodes : []).map(String).filter((item) => /^\d{6}$/.test(item)),
    mealsLeft,
    endingWithinDays: nonNegativeInt(input.endingWithinDays),
    joinedWithinDays: nonNegativeInt(input.joinedWithinDays)
  };
};

const describeFilter = (rawFilter) => {
  const f = normalizeFilter(rawFilter);
  if (f.userIds.length > 0) return `${f.userIds.length} hand-picked customer${f.userIds.length === 1 ? '' : 's'}`;
  const parts = [];
  if (f.statuses.length) parts.push(f.statuses.map((status) => STATUS_LABELS[status]).join(' / '));
  if (f.plans.length) parts.push(`${f.plans.join(' / ')} plan`);
  if (f.diets.length) parts.push(f.diets.map((diet) => DIET_LABELS[diet]).join(' / '));
  if (f.mealSlots.length) parts.push(f.mealSlots.map((slot) => SLOT_LABELS[slot]).join(' / '));
  if (f.carbTypes.length) parts.push(f.carbTypes.join(' / '));
  if (f.mealsLeft) parts.push(`Meals left ${f.mealsLeft.operator} ${f.mealsLeft.value}`);
  if (f.endingWithinDays !== null) parts.push(`Ending within ${f.endingWithinDays} day${f.endingWithinDays === 1 ? '' : 's'}`);
  if (f.joinedWithinDays !== null) parts.push(`Joined in the last ${f.joinedWithinDays} day${f.joinedWithinDays === 1 ? '' : 's'}`);
  if (f.pincodes.length) parts.push(`Pincode ${f.pincodes.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'All customers';
};

const coverageOf = (lunchLeft, dinnerLeft) => {
  if (lunchLeft > 0 && dinnerLeft > 0) return 'both';
  if (lunchLeft > 0) return 'lunch';
  if (dinnerLeft > 0) return 'dinner';
  return 'none';
};

const matchesFilter = (snapshot, rawFilter) => {
  const f = normalizeFilter(rawFilter);
  if (f.userIds.length > 0) return f.userIds.includes(snapshot.id);
  if (f.statuses.length && !f.statuses.includes(snapshot.status)) return false;
  if (f.plans.length && !f.plans.some((plan) => snapshot.currentPlan.includes(plan))) return false;
  if (f.diets.length && !f.diets.includes(snapshot.diet)) return false;
  if (f.mealSlots.length && !f.mealSlots.includes(snapshot.coverage)) return false;
  if (f.carbTypes.length && !f.carbTypes.includes(snapshot.carbType)) return false;
  if (f.pincodes.length && !f.pincodes.includes(snapshot.pincode)) return false;
  if (f.mealsLeft) {
    const total = snapshot.lunchLeft + snapshot.dinnerLeft;
    if (f.mealsLeft.operator === '>' && !(total > f.mealsLeft.value)) return false;
    if (f.mealsLeft.operator === '<' && !(total < f.mealsLeft.value)) return false;
    if (f.mealsLeft.operator === '=' && total !== f.mealsLeft.value) return false;
  }
  if (f.endingWithinDays !== null && (snapshot.daysToEnd === null || snapshot.daysToEnd > f.endingWithinDays)) return false;
  if (f.joinedWithinDays !== null && (snapshot.joinedDaysAgo === null || snapshot.joinedDaysAgo > f.joinedWithinDays)) return false;
  return true;
};

const pincodeOf = (address) => {
  const matches = String(address || '').match(/\b\d{6}\b/g);
  return matches ? matches[matches.length - 1] : '';
};

const buildSnapshot = ({ user, subs, hasDevice, holidayKeys, today, now = Date.now() }) => {
  const active = subs.filter((sub) => sub.status === 'active');
  const queued = subs.filter((sub) => sub.status === 'queued');
  const latest = subs[subs.length - 1];
  let status = 'never';
  if (active.length) status = 'active';
  else if (queued.length) status = 'queued';
  else if (latest) status = 'ended';

  const current = active[0] || queued[0] || latest || null;
  const sum = (field) => active.reduce((total, sub) => total + (sub[field] || 0), 0);
  const lunchLeft = sum('lunchMeals') + sum('nextDayLunchMeals');
  const dinnerLeft = sum('dinnerMeals') + sum('nextDayDinnerMeals');

  let daysToEnd = null;
  active.forEach((sub) => {
    const remaining = Math.max(
      (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0),
      (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0)
    );
    if (remaining <= 0) return;
    const days = diffInCalendarDays(projectExhaustionDate(remaining, holidayKeys), today);
    daysToEnd = daysToEnd === null ? days : Math.max(daysToEnd, days);
  });

  const created = user.createdAt ? new Date(user.createdAt) : null;
  return {
    id: String(user._id),
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    mobile: user.mobile || '',
    status,
    currentPlan: current ? current.plan || '' : '',
    diet: current ? current.mealType || '' : '',
    carbType: current ? current.carbType || '' : '',
    lunchLeft,
    dinnerLeft,
    coverage: coverageOf(lunchLeft, dinnerLeft),
    daysToEnd,
    joinedDaysAgo: created ? Math.floor((now - created.getTime()) / 86400000) : null,
    pincode: pincodeOf(user.postalAddress),
    hasDevice,
    announcementsOptOut: Boolean(user.notificationPrefs && user.notificationPrefs.announcements === false)
  };
};

const loadCustomerSnapshots = async () => {
  const excludedIds = await getExcludedUserIds();
  const users = await User.find(
    { role: 'user', _id: { $nin: excludedIds } },
    'firstName lastName mobile postalAddress createdAt notificationPrefs'
  ).lean();
  const ids = users.map((user) => user._id);

  const [subscriptions, deviceUserIds, holidayKeys] = await Promise.all([
    Subscription.find(
      { userId: { $in: ids } },
      'userId plan status mealType carbType lunchMeals dinnerMeals nextDayLunchMeals nextDayDinnerMeals createdAt'
    )
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    DeviceToken.distinct('userId'),
    loadHolidayKeys(60)
  ]);

  const subsByUser = new Map();
  subscriptions.forEach((sub) => {
    const key = String(sub.userId);
    subsByUser.set(key, [...(subsByUser.get(key) || []), sub]);
  });
  const deviceUsers = new Set(deviceUserIds.map(String));
  const today = todayCalendarDateUTC();

  return users.map((user) =>
    buildSnapshot({
      user,
      subs: subsByUser.get(String(user._id)) || [],
      hasDevice: deviceUsers.has(String(user._id)),
      holidayKeys,
      today
    })
  );
};

const resolveAudience = async (rawFilter, category = 'announcement') => {
  const snapshots = await loadCustomerSnapshots();
  const matched = snapshots.filter((snapshot) => matchesFilter(snapshot, rawFilter));
  const optedOut = category === 'announcement' ? matched.filter((snapshot) => snapshot.announcementsOptOut) : [];
  const recipients = category === 'announcement' ? matched.filter((snapshot) => !snapshot.announcementsOptOut) : matched;
  return { recipients, matched: matched.length, skippedOptOut: optedOut.length };
};

module.exports = {
  normalizeFilter,
  describeFilter,
  matchesFilter,
  buildSnapshot,
  coverageOf,
  loadCustomerSnapshots,
  resolveAudience,
  STATUSES
};
