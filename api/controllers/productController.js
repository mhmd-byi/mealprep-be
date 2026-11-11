const mongoose = require('mongoose');
const Product = require('../models/productModel');
const ProductCategory = require('../models/productCategoryModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { deleteImageByUrl } = require('../utils/s3Storage');
const { MAX_IMAGES, DEFAULT_DAYS } = require('../utils/alacarteRules');

const authorOf = (admin) => ({
  userId: admin._id,
  name: `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Admin'
});

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const shapePublicProduct = (product) => ({
  _id: product._id,
  name: product.name,
  description: product.description || '',
  price: product.price,
  compareAtPrice: product.compareAtPrice || null,
  images: (product.images || []).map((image) => image.url),
  dietType: product.dietType,
  category: product.category || '',
  soldOut: Boolean(product.trackStock) && product.stock <= 0,
  availableDays: product.availableDays && product.availableDays.length ? product.availableDays : DEFAULT_DAYS,
  cutoffDaysBefore: Number.isFinite(product.cutoffDaysBefore) ? product.cutoffDaysBefore : 1,
  cutoffTime: product.cutoffTime || '18:00'
});

const getPublicProducts = async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductCategory.find().sort({ sortOrder: 1, name: 1 }).lean()
    ]);
    const used = new Set(products.map((product) => product.category).filter(Boolean));
    const ordered = categories.map((category) => category.name).filter((name) => used.has(name));
    used.forEach((name) => {
      if (!ordered.includes(name)) ordered.push(name);
    });
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ categories: ordered, products: products.map(shapePublicProduct) });
  } catch (error) {
    serverError(res, 'loading public products', error);
  }
};

const isMoney = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000;

const validateProductInput = async (input = {}) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { error: 'A product name is required.' };
  if (name.length > 120) return { error: 'The name must be 120 characters or fewer.' };

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 1000) return { error: 'The description must be 1000 characters or fewer.' };

  const price = Number(input.price);
  if (!isMoney(price)) return { error: 'Enter a valid price.' };

  let compareAtPrice = null;
  if (input.compareAtPrice !== undefined && input.compareAtPrice !== null && input.compareAtPrice !== '') {
    compareAtPrice = Number(input.compareAtPrice);
    if (!isMoney(compareAtPrice)) return { error: 'Enter a valid old price.' };
    if (compareAtPrice <= price) return { error: 'The old price must be higher than the price.' };
  }

  if (!['veg', 'non-veg'].includes(input.dietType)) return { error: 'Choose veg or non-veg.' };

  let category = '';
  if (input.category) {
    const found = await ProductCategory.findOne({ name: String(input.category).trim() }).collation({ locale: 'en', strength: 2 });
    if (!found) return { error: 'That category does not exist.' };
    category = found.name;
  }

  const imageInput = Array.isArray(input.images) ? input.images : [];
  if (imageInput.length > MAX_IMAGES) return { error: `You can add up to ${MAX_IMAGES} photos.` };
  const images = [];
  for (const item of imageInput) {
    const url = typeof item === 'string' ? item : item && item.url;
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return { error: 'A photo link is not valid.' };
    images.push({ url });
  }

  const trackStock = Boolean(input.trackStock);
  let stock = 0;
  if (trackStock) {
    stock = Number(input.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) return { error: 'Enter a valid stock count.' };
  }

  const dayInput = Array.isArray(input.availableDays) ? input.availableDays.map(Number) : DEFAULT_DAYS;
  const availableDays = [...new Set(dayInput)].filter((day) => Number.isInteger(day) && day >= 1 && day <= 6).sort((a, b) => a - b);
  if (availableDays.length === 0) return { error: 'Choose at least one day.' };

  const cutoffDaysBefore = input.cutoffDaysBefore === undefined ? 1 : Number(input.cutoffDaysBefore);
  if (!Number.isInteger(cutoffDaysBefore) || cutoffDaysBefore < 0 || cutoffDaysBefore > 7) {
    return { error: 'Choose how many days before delivery ordering closes.' };
  }
  const cutoffTime = input.cutoffTime === undefined ? '18:00' : String(input.cutoffTime);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) return { error: 'Enter the cut-off time as HH:MM.' };

  const sortOrder = input.sortOrder === undefined || input.sortOrder === '' ? 0 : Number(input.sortOrder);
  if (!Number.isInteger(sortOrder)) return { error: 'The display order must be a whole number.' };

  return {
    value: {
      name,
      description,
      price,
      compareAtPrice,
      dietType: input.dietType,
      category,
      images,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      trackStock,
      stock,
      availableDays,
      cutoffDaysBefore,
      cutoffTime,
      sortOrder
    }
  };
};

const listAdminProducts = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const products = await Product.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json(products);
  } catch (error) {
    serverError(res, 'listing products', error);
  }
};

const createProduct = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const checked = await validateProductInput(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });
    const author = authorOf(admin);
    const product = await Product.create({ ...checked.value, createdBy: author, updatedBy: author });
    res.status(201).json(product);
  } catch (error) {
    serverError(res, 'creating a product', error);
  }
};

const updateProduct = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.productId)) return res.status(404).json({ message: 'Product not found.' });
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    const checked = await validateProductInput(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });

    const keptUrls = new Set(checked.value.images.map((image) => image.url));
    const removed = (product.images || []).filter((image) => !keptUrls.has(image.url));

    Object.assign(product, checked.value, { updatedBy: authorOf(admin) });
    await product.save();
    removed.forEach((image) => deleteImageByUrl(image.url));
    res.json(product);
  } catch (error) {
    serverError(res, 'updating a product', error);
  }
};

const setProductActive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.productId)) return res.status(404).json({ message: 'Product not found.' });
    const product = await Product.findByIdAndUpdate(
      req.params.productId,
      { $set: { isActive: Boolean(req.body.isActive), updatedBy: authorOf(admin) } },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    res.json(product);
  } catch (error) {
    serverError(res, 'changing product visibility', error);
  }
};

const deleteProduct = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.productId)) return res.status(404).json({ message: 'Product not found.' });
    const product = await Product.findByIdAndDelete(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    (product.images || []).forEach((image) => deleteImageByUrl(image.url));
    res.json({ message: 'Product deleted.' });
  } catch (error) {
    serverError(res, 'deleting a product', error);
  }
};

const listProductCategories = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const [categories, counts] = await Promise.all([
      ProductCategory.find().sort({ sortOrder: 1, name: 1 }).lean(),
      Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }])
    ]);
    const countByName = new Map(counts.map((row) => [row._id, row.count]));
    res.json(categories.map((category) => ({ ...category, productCount: countByName.get(category.name) || 0 })));
  } catch (error) {
    serverError(res, 'listing product categories', error);
  }
};

const createProductCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ message: 'A category name is required.' });
    if (name.length > 60) return res.status(400).json({ message: 'The name must be 60 characters or fewer.' });
    const duplicate = await ProductCategory.findOne({ name }).collation({ locale: 'en', strength: 2 });
    if (duplicate) return res.status(400).json({ message: 'A category with this name already exists.' });
    const sortOrder = Number.isInteger(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;
    const category = await ProductCategory.create({ name, sortOrder });
    res.status(201).json(category);
  } catch (error) {
    serverError(res, 'creating a product category', error);
  }
};

const updateProductCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.categoryId)) return res.status(404).json({ message: 'Category not found.' });
    const category = await ProductCategory.findById(req.params.categoryId);
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    const oldName = category.name;

    if (req.body.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ message: 'The category name cannot be empty.' });
      if (name.length > 60) return res.status(400).json({ message: 'The name must be 60 characters or fewer.' });
      const duplicate = await ProductCategory.findOne({ name, _id: { $ne: category._id } }).collation({ locale: 'en', strength: 2 });
      if (duplicate) return res.status(400).json({ message: 'A category with this name already exists.' });
      category.name = name;
    }
    if (req.body.sortOrder !== undefined && Number.isInteger(Number(req.body.sortOrder))) {
      category.sortOrder = Number(req.body.sortOrder);
    }
    await category.save();
    if (category.name !== oldName) {
      await Product.updateMany({ category: oldName }, { $set: { category: category.name } });
    }
    res.json(category);
  } catch (error) {
    serverError(res, 'updating a product category', error);
  }
};

const deleteProductCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.categoryId)) return res.status(404).json({ message: 'Category not found.' });
    const category = await ProductCategory.findByIdAndDelete(req.params.categoryId);
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    await Product.updateMany({ category: category.name }, { $set: { category: '' } });
    res.json({ message: 'Category deleted.' });
  } catch (error) {
    serverError(res, 'deleting a product category', error);
  }
};

module.exports = {
  getPublicProducts,
  listAdminProducts,
  createProduct,
  updateProduct,
  setProductActive,
  deleteProduct,
  listProductCategories,
  createProductCategory,
  updateProductCategory,
  deleteProductCategory
};
