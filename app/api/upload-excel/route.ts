import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { adminRateLimiter, getClientIp } from '@/lib/rateLimiter';
import { sanitizeString, verifyAdminRequest, errorResponse, successResponse } from '@/lib/validation';

export const runtime = 'nodejs';

// 10MB max file size
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface ParticipantRow {
  name: string;
  email: string;
  sapid: string;
}

export async function POST(req: NextRequest) {
  // 1. Rate limiting
  const ip = getClientIp(req);
  try {
    await adminRateLimiter.consume(ip);
  } catch {
    return errorResponse('Too many requests.', 429);
  }

  // 2. Parse form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse('Invalid form data.', 400);
  }

  // 3. Verify admin session cookie (or fallback password from formData)
  const password = sanitizeString(formData.get('password') as string);
  if (!verifyAdminRequest(req, password)) {
    return errorResponse('Unauthorized. Invalid or expired admin session.', 401);
  }

  // 4. Get the file
  const file = formData.get('file') as File | null;
  if (!file) {
    return errorResponse('No file provided.', 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return errorResponse('File too large. Maximum 10MB allowed.', 400);
  }

  const isExcelByExtension = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
    '',
  ];
  if (!isExcelByExtension && !allowedTypes.includes(file.type)) {
    return errorResponse('Only Excel files (.xlsx, .xls) are allowed.', 400);
  }

  // Helper to extract value by fuzzy/normalized column headers
  function getColumnValue(row: Record<string, unknown>, aliases: string[]): string {
    const cleanAliases = aliases.map((a) => a.toLowerCase().replace(/[\s_\-.]/g, ''));
    for (const key of Object.keys(row)) {
      const cleanKey = key.toLowerCase().replace(/[\s_\-.]/g, '');
      if (cleanAliases.includes(cleanKey)) {
        const val = row[key];
        if (val !== undefined && val !== null && val !== '') {
          if (typeof val === 'number') {
            return Number.isInteger(val) ? val.toString() : val.toFixed(0);
          }
          return String(val);
        }
      }
    }
    return '';
  }

  // 5. Parse Excel
  const buffer = await file.arrayBuffer();
  let participants: ParticipantRow[];

  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });

    const uniqueMap = new Map<string, ParticipantRow>();

    for (const row of rows) {
      const name = sanitizeString(
        getColumnValue(row, ['name', 'fullname', 'studentname', 'participantname', 'attendee'])
      ).trim();

      const email = sanitizeString(
        getColumnValue(row, ['email', 'emailid', 'emailaddress', 'mail'])
      ).toLowerCase().trim();

      const sapid = sanitizeString(
        getColumnValue(row, ['sapid', 'sap', 'sap_id', 'sap id', 'studentid', 'rollno', 'rollnumber', 'id', 'enrollmentno'])
      ).trim();

      if (name && email && sapid) {
        // Deduplicate rows with identical (email, sapid) in the Excel itself
        const dedupKey = `${email}:::${sapid}`;
        if (!uniqueMap.has(dedupKey)) {
          uniqueMap.set(dedupKey, { name, email, sapid });
        }
      }
    }

    participants = Array.from(uniqueMap.values());
  } catch (err) {
    console.error('[upload-excel] Parse error:', err);
    return errorResponse('Failed to parse Excel file. Ensure columns: name, email, sapid', 400);
  }

  if (participants.length === 0) {
    return errorResponse(
      'No valid rows found. Excel must have columns for Name, Email, and SAP ID.',
      400
    );
  }

  // 6. Clear existing participants and insert new ones
  const { error: deleteError } = await getSupabaseAdmin()
    .from('participants')
    .delete()
    .neq('id', 0); // delete all

  if (deleteError) {
    console.error('[upload-excel] Delete error:', deleteError.message);
    return errorResponse('Failed to clear existing data: ' + deleteError.message, 500);
  }

  // 7. Insert in batches using upsert with onConflict to guarantee resilience against duplicates
  const BATCH_SIZE = 500;
  for (let i = 0; i < participants.length; i += BATCH_SIZE) {
    const batch = participants.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await getSupabaseAdmin()
      .from('participants')
      .upsert(batch, { onConflict: 'email,sapid' });

    if (insertError) {
      console.error('[upload-excel] Insert error:', insertError.message);
      return errorResponse('Failed to save participants: ' + insertError.message, 500);
    }
  }

  // 8. Update settings with upload timestamp
  await getSupabaseAdmin().from('settings').upsert({
    key: 'last_upload',
    value: new Date().toISOString(),
  });

  return successResponse({
    success: true,
    count: participants.length,
    message: `Successfully uploaded ${participants.length} participants.`,
  });
}

