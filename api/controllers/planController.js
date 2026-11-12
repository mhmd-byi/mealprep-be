const mongoose = require('mongoose');
const Plan = require('../models/planModel');
const Subscription = require('../models/subscriptionModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { DEFAULT_PLANS, shapePlan, loadAllPlans, backfillPricePerMeal } = require('../utils/planCatalog');

const COLLATION = { locale: 'en', strength: 2 };
const MAX_FEATURES = 8;

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const validatePlanInput = (input = {}) => {
  const name = text(input.name, 60);
  if (!name) return { error: 'A plan name is required.' };

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 1 || price > 1000000) return { error: 'Enter a price of at least ₹1.' };

  const meals = Number(input.meals);
  if (!Number.isInteger(meals) || meals < 1 || meals > 200) return { error: 'Meals must be a whole number between 1 and 200.' };

  const featuresInput = Array.isArray(input.features) ? input.features : [];
  const features = featuresInput.map((item) => text(item, 120)).filter(Boolean);
  if (features.length > MAX_FEATURES) return { error: `You can list up to ${MAX_FEATURES} features.` };

  const color = typeof input.color === 'string' && input.color ? input.color.trim() : '#6b7280';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Choose a valid colour.' };

  const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
  if (imageUrl && !/^https:\/\/\S{1,480}$/.test(imageUrl)) return { error: 'The image link is not valid.' };

  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;

  return {
    value: {
      name,
      price: Math.round(price * 100) / 100,
      meals,
      period: text(input.period, 20),
      description: text(input.description, 200),
      features,
      color,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      sortOrder,
      websiteTitle: text(input.websiteTitle, 80),
      validityText: text(input.validityText, 80),
      imageUrl
    }
  };
};

const getPublicPlans = async (req, res) => {
  try {
    const plans = await loadAllPlans();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(plans.map(shapePlan));
  } catch (error) {
    serverError(res, 'loading public plans', error);
  }
};

const buildAdminList = async () => {
  const stored = await Plan.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  const counts = await Subscription.aggregate([
    { $group: { _id: '$plan', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } }
  ]);
  const byName = new Map(counts.map((row) => [row._id, row]));
  const source = stored.length > 0 ? stored : DEFAULT_PLANS;
  return {
    needsSetup: stored.length === 0,
    plans: source.map((plan) => ({
      ...shapePlan(plan),
      subscriberCount: byName.get(plan.name)?.total || 0,
      activeCount: byName.get(plan.name)?.active || 0
    }))
  };
};

const listAdminPlans = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json(await buildAdminList());
  } catch (error) {
    serverError(res, 'listing plans', error);
  }
};

const setupDefaultPlans = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if ((await Plan.estimatedDocumentCount()) > 0) {
      return res.status(409).json({ message: 'Plans are already set up.' });
    }
    await Plan.insertMany(DEFAULT_PLANS);
    for (const plan of DEFAULT_PLANS) {
      await backfillPricePerMeal(plan.name, plan.price, plan.meals);
    }
    res.status(201).json(await buildAdminList());
  } catch (error) {
    serverError(res, 'setting up the default plans', error);
  }
};

const createPlan = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const checked = validatePlanInput(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });

    if (await Plan.findOne({ name: checked.value.name }).collation(COLLATION)) {
      return res.status(400).json({ message: 'A plan with this name already exists.' });
    }
    if ((await Plan.estimatedDocumentCount()) === 0) {
      await Plan.insertMany(DEFAULT_PLANS);
      for (const plan of DEFAULT_PLANS) {
        await backfillPricePerMeal(plan.name, plan.price, plan.meals);
      }
    }

    const plan = await Plan.create(checked.value);
    res.status(201).json(shapePlan(plan.toObject()));
  } catch (error) {
    serverError(res, 'creating a plan', error);
  }
};

const updatePlan = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.planId)) return res.status(404).json({ message: 'Plan not found.' });

    const plan = await Plan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });

    const checked = validatePlanInput({ ...plan.toObject(), ...req.body });
    if (checked.error) return res.status(400).json({ message: checked.error });

    const next = checked.value;
    if (next.name.toLowerCase() !== plan.name.toLowerCase()) {
      const duplicate = await Plan.findOne({ name: next.name, _id: { $ne: plan._id } }).collation(COLLATION);
      if (duplicate) return res.status(400).json({ message: 'A plan with this name already exists.' });
    }

    const oldName = plan.name;
    if (next.price !== plan.price || next.meals !== plan.meals) {
      await backfillPricePerMeal(oldName, plan.price, plan.meals);
    }

    Object.assign(plan, next);
    await plan.save();

    if (next.name !== oldName) {
      await Subscription.updateMany({ plan: oldName }, { $set: { plan: next.name } });
    }

    res.json(shapePlan(plan.toObject()));
  } catch (error) {
    serverError(res, 'updating a plan', error);
  }
};

const setPlanActive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.planId)) return res.status(404).json({ message: 'Plan not found.' });
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be true or false.' });

    const plan = await Plan.findByIdAndUpdate(req.params.planId, { $set: { isActive: req.body.isActive } }, { new: true }).lean();
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });
    res.json(shapePlan(plan));
  } catch (error) {
    serverError(res, 'changing a plan', error);
  }
};

const deletePlan = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.planId)) return res.status(404).json({ message: 'Plan not found.' });

    const plan = await Plan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });
    if (await Subscription.exists({ plan: plan.name })) {
      return res.status(409).json({ message: 'Customers have subscribed to this plan, so it cannot be deleted. Archive it instead.' });
    }

    await plan.deleteOne();
    res.json({ message: 'Plan deleted.' });
  } catch (error) {
    serverError(res, 'deleting a plan', error);
  }
};

module.exports = { getPublicPlans, listAdminPlans, setupDefaultPlans, createPlan, updatePlan, setPlanActive, deletePlan };
