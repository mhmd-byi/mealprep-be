const PDFDocument = require('pdfkit');
const { DateTime } = require('luxon');
const { IST_ZONE } = require('./dateUtils');

const BRAND = '#3C9B62';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

const DIET_LABELS = { veg: 'Veg', 'non-veg': 'Non-veg', both: 'Veg and non-veg' };

const sellerDetails = () => ({
  name: process.env.INVOICE_BUSINESS_NAME || 'Mealprep',
  address: process.env.INVOICE_ADDRESS || '',
  email: process.env.INVOICE_EMAIL || 'hello@mealprep.co.in',
  phone: process.env.INVOICE_PHONE || '',
  gstin: process.env.INVOICE_GSTIN || ''
});

const formatMoney = (amount) =>
  `INR ${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDay = (date) => DateTime.fromJSDate(new Date(date), { zone: IST_ZONE }).toFormat('d LLL yyyy');

const invoiceNumber = (subscription) =>
  `MP-${DateTime.fromJSDate(new Date(subscription.createdAt), { zone: IST_ZONE }).toFormat('yyMMdd')}-${String(subscription._id).slice(-6).toUpperCase()}`;

const paymentMethodLabel = (subscription) => (subscription.orderId ? 'Online (Razorpay)' : subscription.paymentMethod || 'Paid');

const buildInvoicePdf = ({ subscription, customer, amount, carbLabel }) =>
  new Promise((resolve, reject) => {
    const seller = sellerDetails();
    const number = invoiceNumber(subscription);
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${number}`, Author: seller.name } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(24).text(seller.name, left, 50, { width: width / 2 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('INVOICE', left, 54, { width, align: 'right' });

    const sellerLines = [seller.address, seller.email, seller.phone && `Phone: ${seller.phone}`, seller.gstin && `GSTIN: ${seller.gstin}`].filter(Boolean);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    let y = 82;
    sellerLines.forEach((line) => {
      doc.text(line, left, y, { width: width / 2 });
      y = doc.y + 1;
    });

    y = Math.max(y, 110) + 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 16;

    const column = width / 2;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('BILLED TO', left, y);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer', left, y + 14, { width: column - 20 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    [customer.email, customer.mobile, customer.postalAddress].filter(Boolean).forEach((line) => doc.text(line, left, doc.y + 2, { width: column - 20 }));
    const leftEnd = doc.y;

    const metaRows = [
      ['Invoice no.', number],
      ['Invoice date', formatDay(subscription.createdAt)],
      ['Status', 'Paid'],
      ['Payment method', paymentMethodLabel(subscription)]
    ];
    const reference = subscription.paymentId || subscription.orderId;
    if (reference) metaRows.push(['Reference', reference]);

    let metaY = y;
    metaRows.forEach(([label, value]) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, left + column, metaY, { width: 90 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(String(value), left + column + 95, metaY, { width: column - 95 });
      metaY = Math.max(doc.y, metaY + 14) + 2;
    });

    y = Math.max(leftEnd, metaY) + 24;

    doc.rect(left, y, width, 24).fill('#f3f4f6');
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', left + 10, y + 8, { width: width - 190 });
    doc.text('MEALS', right - 170, y + 8, { width: 60, align: 'right' });
    doc.text('AMOUNT', right - 100, y + 8, { width: 90, align: 'right' });
    y += 34;

    const details = [
      DIET_LABELS[subscription.mealType] || subscription.mealType,
      carbLabel,
      `Starts ${formatDay(subscription.subscriptionStartDate)}`
    ].filter(Boolean);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(subscription.plan, left + 10, y, { width: width - 190 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(details.join('  |  '), left + 10, doc.y + 3, { width: width - 190 });
    const rowEnd = doc.y;
    doc.fillColor(INK).font('Helvetica').fontSize(11);
    doc.text(String(subscription.totalMeals), right - 170, y, { width: 60, align: 'right' });
    doc.text(formatMoney(amount), right - 120, y, { width: 110, align: 'right' });

    y = rowEnd + 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 14;

    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Total paid', right - 260, y, { width: 130, align: 'right' });
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(14).text(formatMoney(amount), right - 125, y - 2, { width: 125, align: 'right' });

    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
    doc.text('This is a computer-generated invoice and does not need a signature.', left, 760, { width, align: 'center' });
    doc.text(`Thank you for choosing ${seller.name}.`, left, doc.y + 3, { width, align: 'center' });

    doc.end();
  });

module.exports = { buildInvoicePdf, invoiceNumber };
