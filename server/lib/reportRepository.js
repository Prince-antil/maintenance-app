import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseServerClient, SUPABASE_DOCUMENT_BUCKET } from './supabase.js';

export const CATEGORIES = [
  'Monthly PM Report',
  'Plantwise Breakdown Report',
  'Machine Asset Register',
  'FAT (Factory Acceptance Test)',
  'Energy Report (DG 500 & 380KVA)',
  'Energy Report (Solar)',
  'Plantwise Energy Consumption',
  'Kaizen',
  'Improvement',
  'ORM Data (Operational Risk Management)',
];

export const PLANT_SECTIONS = [
  'Overall Nathupur Maintenance Formulation Plant (Master Combined View)',
  'Formulation Park',
  'Herbi ACM Formulation',
  'Herbi EC Packaging',
  'EC Herbi Formulation',
  'SC Herbicide Formulation',
  'SC Herbicide Packaging',
  'Topper Formulation Herbi',
  'Herbi Packaging',
  'ACM-1 INSEC Formulation',
  'EC INSEC Packaging',
  'EC INSEC FORMULATION',
  'Finish Goods',
  'CARTAP FORMULATION INSEC',
  'CARTAP PACKAGING INSEC',
  'JET MILL FORMULATION INSEC',
  'PRINTING SECTION EC',
  'SC INSEC FORMULATION',
  'Acephate/Zivora Packaging INSEC',
  'STORE',
  'Utility Section',
];

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const ALLOWED_EXTENSIONS = ['.doc', '.docx', '.xlsx', '.xls', '.csv', '.ppt', '.pptx', '.pdf'];

function sanitizeName(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const base = path.basename(filename || 'document', ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
  return `${base}${ext}`;
}

function toApiRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    category_name: row.category_name,
    filename: row.file_name,
    public_url: row.public_url,
    file_url: row.public_url,
    file_format: row.file_format,
    reporting_month: row.reporting_month,
    reporting_year: row.reporting_year,
    plant_section: row.plant_section,
    uploaded_at: row.uploaded_at,
    uploaded_by: row.uploaded_by,
    uploader_name: row.uploaded_by,
    storage_path: row.storage_path,
  };
}

async function removeStoredObject(storagePath) {
  if (!storagePath) return;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.storage.from(SUPABASE_DOCUMENT_BUCKET).remove([storagePath]);
  if (error) {
    throw new Error(error.message || 'Failed to remove document from Supabase storage');
  }
}

export async function listReports(filters = {}) {
  const {
    category,
    month,
    year,
    plant_section,
    file_format,
    search,
    page = 1,
    limit = 20,
  } = filters;

  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 20);
  const offset = (safePage - 1) * safeLimit;

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from('document_repository')
    .select('*', { count: 'exact' })
    .order('uploaded_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (category) query = query.eq('category_name', category);
  if (month) query = query.eq('reporting_month', month);
  if (year) query = query.eq('reporting_year', Number.parseInt(year, 10));
  if (plant_section) query = query.eq('plant_section', plant_section);
  if (file_format) query = query.eq('file_format', file_format);
  if (search) {
    const term = String(search).trim().replace(/[%_,]/g, ' ');
    query = query.or(`file_name.ilike.%${term}%,category_name.ilike.%${term}%,plant_section.ilike.%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message || 'Failed to fetch reports');

  return {
    data: (data || []).map(toApiRow),
    total: count || 0,
    page: safePage,
    totalPages: Math.max(1, Math.ceil((count || 0) / safeLimit)),
  };
}

export async function getRecentReports(limit = 10) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('document_repository')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message || 'Failed to fetch recent reports');
  return (data || []).map(toApiRow);
}

export async function getReportById(id) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('document_repository')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to fetch report');
  return toApiRow(data);
}

export async function getCategoryStats() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('document_repository')
    .select('category_name, uploaded_at');

  if (error) throw new Error(error.message || 'Failed to fetch category stats');

  return CATEGORIES.map((categoryName) => {
    const rows = (data || []).filter((row) => row.category_name === categoryName);
    const lastUploaded = rows
      .map((row) => row.uploaded_at)
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] || null;

    return {
      category_name: categoryName,
      file_count: rows.length,
      last_uploaded: lastUploaded,
    };
  });
}

export function getReportMeta() {
  return { categories: CATEGORIES, plant_sections: PLANT_SECTIONS, months: MONTHS };
}

export async function createReportFromUpload({ file, body, userName }) {
  if (!file) {
    throw new Error('No file uploaded');
  }

  const { category_name, reporting_month, reporting_year, plant_section } = body;
  if (!category_name || !reporting_month || !reporting_year || !plant_section) {
    throw new Error('All fields are required');
  }
  if (!CATEGORIES.includes(category_name)) {
    throw new Error('Invalid category');
  }
  if (!MONTHS.includes(reporting_month)) {
    throw new Error('Invalid reporting month');
  }

  const parsedYear = Number.parseInt(reporting_year, 10);
  if (!Number.isInteger(parsedYear)) {
    throw new Error('Invalid reporting year');
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`File type ${ext} not allowed`);
  }

  const id = uuidv4();
  const storagePath = `reports/${parsedYear}/${String(reporting_month).toLowerCase()}/${id}-${sanitizeName(file.originalname)}`;
  const uploadedAt = new Date().toISOString();
  const supabase = getSupabaseServerClient();

  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_DOCUMENT_BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype || undefined,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload file to Supabase storage');
  }

  const { data: urlData } = supabase.storage
    .from(SUPABASE_DOCUMENT_BUCKET)
    .getPublicUrl(storagePath);

  const row = {
    id,
    category_name,
    file_name: file.originalname,
    public_url: urlData.publicUrl,
    storage_path: storagePath,
    file_format: ext,
    reporting_month,
    reporting_year: parsedYear,
    plant_section,
    uploaded_at: uploadedAt,
    uploaded_by: userName || 'System',
  };

  const { data, error } = await supabase
    .from('document_repository')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    await removeStoredObject(storagePath);
    throw new Error(error.message || 'Failed to save report metadata');
  }

  return toApiRow(data);
}

export async function updateReportRecord(id, patch) {
  const nextPatch = {};
  if (patch.category_name) {
    if (!CATEGORIES.includes(patch.category_name)) throw new Error('Invalid category');
    nextPatch.category_name = patch.category_name;
  }
  if (patch.reporting_month) {
    if (!MONTHS.includes(patch.reporting_month)) throw new Error('Invalid reporting month');
    nextPatch.reporting_month = patch.reporting_month;
  }
  if (patch.reporting_year !== undefined) {
    const parsedYear = Number.parseInt(patch.reporting_year, 10);
    if (!Number.isInteger(parsedYear)) throw new Error('Invalid reporting year');
    nextPatch.reporting_year = parsedYear;
  }
  if (patch.plant_section) {
    nextPatch.plant_section = patch.plant_section;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('document_repository')
    .update(nextPatch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to update report metadata');
  return toApiRow(data);
}

export async function deleteReportRecord(id) {
  const supabase = getSupabaseServerClient();
  const existing = await getReportById(id);
  if (!existing) {
    throw new Error('Report not found');
  }

  await removeStoredObject(existing.storage_path);

  const { error } = await supabase
    .from('document_repository')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(error.message || 'Failed to delete report metadata');
  }
}
