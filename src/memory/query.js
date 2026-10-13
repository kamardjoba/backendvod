import { clone, nextId, nowIso, state } from './state.js';

function normalizeSql(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function rows(result = []) {
  return { rows: result.map(clone), rowCount: result.length };
}

function findUserByEmail(email) {
  return state.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function sortDrivers(users) {
  return [...users].sort((a, b) => {
    const ln = a.last_name.localeCompare(b.last_name, 'ru');
    if (ln !== 0) return ln;
    return a.first_name.localeCompare(b.first_name, 'ru');
  });
}

export async function memoryQuery(text, params = []) {
  const sql = normalizeSql(text);

  if (sql.startsWith('select * from users where lower(email) = lower($1)')) {
    const user = findUserByEmail(params[0]);
    return rows(user ? [user] : []);
  }

  if (sql.startsWith('select id, first_name, last_name, email, phone, role, is_active from users where id = $1')) {
    const user = state.users.find((u) => u.id === params[0]);
    return rows(user ? [user] : []);
  }

  if (sql.startsWith('select * from users where id = $1 and role = \'driver\'')) {
    const user = state.users.find((u) => u.id === params[0] && u.role === 'driver');
    return rows(user ? [user] : []);
  }

  if (sql.startsWith('select * from users where id = $1')) {
    const user = state.users.find((u) => u.id === params[0]);
    return rows(user ? [user] : []);
  }

  if (sql.startsWith('select * from users where role = \'driver\' order by last_name, first_name')) {
    return rows(sortDrivers(state.users.filter((u) => u.role === 'driver')));
  }

  if (sql.startsWith('select id from users where email = $1')) {
    const user = findUserByEmail(params[0]);
    return rows(user ? [{ id: user.id }] : []);
  }

  if (sql.startsWith('select id from users where role = \'administrator\' and is_active = true')) {
    return rows(state.users.filter((u) => u.role === 'administrator' && u.is_active).map((u) => ({ id: u.id })));
  }

  if (sql.startsWith('insert into users')) {
    const [firstName, lastName, email, passwordHash, phone, role = 'driver'] =
      params.length === 5 ? [...params, 'driver'] : params;
    if (findUserByEmail(email)) {
      const err = new Error('duplicate key');
      err.code = '23505';
      throw err;
    }
    const ts = nowIso();
    const user = {
      id: nextId('users'),
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      phone: phone ?? null,
      role: role.replace(/'/g, '') === 'driver' ? 'driver' : params[5] === undefined ? 'driver' : 'driver',
      is_active: true,
      created_at: ts,
      updated_at: ts,
    };
    if (sql.includes("'administrator'")) {
      user.role = 'administrator';
    } else {
      user.role = 'driver';
    }
    // Fix insert parsing - two insert patterns
    if (params.length === 5 && sql.includes("'driver'")) {
      user.role = 'driver';
    }
    if (params.length === 4 && sql.includes("'administrator'")) {
      user.role = 'administrator';
    }
    state.users.push(user);
    if (sql.includes('returning id, first_name')) {
      return rows([
        {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          is_active: user.is_active,
          created_at: user.created_at,
        },
      ]);
    }
    return rows([user]);
  }

  if (sql.startsWith('update users set') && sql.includes('coalesce')) {
    const user = state.users.find((u) => u.id === params[4]);
    if (!user) return rows([]);
    if (params[0] != null) user.first_name = params[0];
    if (params[1] != null) user.last_name = params[1];
    if (params[2] != null) user.phone = params[2];
    if (params[3] != null) user.is_active = params[3];
    user.updated_at = nowIso();
    return rows([user]);
  }

  if (sql.startsWith('update users set updated_at = now() where id = $1')) {
    const user = state.users.find((u) => u.id === params[0]);
    if (user) user.updated_at = nowIso();
    return rows([]);
  }

  if (sql.startsWith('select * from rest_periods') && sql.includes("status = 'active'") && sql.includes('limit 1')) {
    const list = state.rest_periods
      .filter((r) => r.driver_id === params[0] && r.status === 'active')
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    return rows(list.slice(0, 1));
  }

  if (sql.startsWith('select * from rest_periods') && sql.includes('order by started_at desc') && sql.includes('limit $2')) {
    const list = state.rest_periods
      .filter((r) => r.driver_id === params[0])
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      .slice(0, params[1]);
    return rows(list);
  }

  if (sql.startsWith('insert into rest_periods')) {
    const [
      driverId,
      restType,
      startedAt,
      plannedDurationMinutes,
      initialPlannedEndAt,
      currentPlannedEndAt,
      driverComment,
    ] = params;
    const ts = nowIso();
    const row = {
      id: nextId('rest_periods'),
      driver_id: driverId,
      rest_type: restType,
      started_at: startedAt,
      planned_duration_minutes: plannedDurationMinutes,
      initial_planned_end_at: initialPlannedEndAt,
      current_planned_end_at: currentPlannedEndAt,
      actual_availability_at: null,
      driver_comment: driverComment,
      status: 'active',
      last_updated_by: 'driver',
      created_at: ts,
      updated_at: ts,
    };
    state.rest_periods.push(row);
    return rows([row]);
  }

  if (sql.includes('update rest_periods') && sql.includes('current_planned_end_at = $1')) {
    const row = state.rest_periods.find((r) => r.id === (params[2] ?? params[1]));
    if (!row) return rows([]);
    row.current_planned_end_at = params[0];
    if (params[1] != null && sql.includes('driver_comment')) row.driver_comment = params[1] ?? row.driver_comment;
    row.last_updated_by = sql.includes('administrator') ? 'administrator' : 'driver';
    row.updated_at = nowIso();
    return rows([row]);
  }

  if (sql.includes('update rest_periods') && sql.includes("status = 'completed'")) {
    const row = state.rest_periods.find((r) => r.id === params[0]);
    if (!row) return rows([]);
    row.status = 'completed';
    row.actual_availability_at = nowIso();
    row.last_updated_by = sql.includes('administrator') ? 'administrator' : 'driver';
    row.updated_at = nowIso();
    return rows([row]);
  }

  if (sql.startsWith('insert into audit_logs')) {
    const row = {
      id: nextId('audit_logs'),
      actor_user_id: params[0],
      target_driver_id: params[1],
      action: params[2],
      old_value: params[3],
      new_value: params[4],
      created_at: nowIso(),
    };
    state.audit_logs.push(row);
    return rows([row]);
  }

  if (sql.startsWith('select a.*, u.first_name, u.last_name from audit_logs a') && sql.includes('target_driver_id = $1')) {
    const list = state.audit_logs
      .filter((a) => a.target_driver_id === params[0])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 100)
      .map((a) => {
        const u = state.users.find((x) => x.id === a.actor_user_id);
        return { ...a, first_name: u?.first_name ?? null, last_name: u?.last_name ?? null };
      });
    return rows(list);
  }

  if (sql.startsWith('select a.*, u.first_name, u.last_name from audit_logs a') && sql.includes('limit 200')) {
    const list = state.audit_logs
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 200)
      .map((a) => {
        const u = state.users.find((x) => x.id === a.actor_user_id);
        return { ...a, first_name: u?.first_name ?? null, last_name: u?.last_name ?? null };
      });
    return rows(list);
  }

  if (sql.startsWith('insert into notifications')) {
    const row = {
      id: nextId('notifications'),
      user_id: params[0],
      type: params[1],
      title: params[2],
      body: params[3],
      meta: params[4],
      is_read: false,
      created_at: nowIso(),
    };
    state.notifications.push(row);
    return rows([row]);
  }

  if (sql.startsWith('select * from notifications where user_id = $1 order by created_at desc limit $2')) {
    const list = state.notifications
      .filter((n) => n.user_id === params[0])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, params[1]);
    return rows(list);
  }

  if (sql.startsWith('update notifications set is_read = true where user_id = $1 and id = any($2::int[])')) {
    for (const n of state.notifications) {
      if (n.user_id === params[0] && params[1].includes(n.id)) n.is_read = true;
    }
    return rows([]);
  }

  if (sql.includes('from rest_periods rp') && sql.includes('join users u')) {
    const list = state.rest_periods
      .filter((r) => r.status === 'active')
      .map((r) => {
        const u = state.users.find((x) => x.id === r.driver_id);
        return { ...r, first_name: u?.first_name, last_name: u?.last_name };
      });
    return rows(list);
  }

  if (sql.includes('select 1 from notifications') && sql.includes("type = 'rest_two_hours'")) {
    const exists = state.notifications.some(
      (n) => n.type === 'rest_two_hours' && String(n.meta?.restPeriodId) === String(params[0])
    );
    return rows(exists ? [{ '?column?': 1 }] : []);
  }

  if (sql.includes('select 1 from notifications') && sql.includes("type = 'availability_time_reached'")) {
    const exists = state.notifications.some(
      (n) => n.type === 'availability_time_reached' && String(n.meta?.restPeriodId) === String(params[0])
    );
    return rows(exists ? [{ '?column?': 1 }] : []);
  }

  console.error('Memory SQL not implemented:', sql);
  throw new Error(`Memory mode: unsupported query: ${sql.slice(0, 120)}`);
}
