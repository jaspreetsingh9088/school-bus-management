import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// API address, set at build time: flutter build apk --dart-define=API_URL=https://...
const String apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');

class ApiException implements Exception {
  ApiException(this.status, this.message, [this.body]);
  final int status;
  final String message;
  final dynamic body;
  @override
  String toString() => message;
}

class Session {
  Session({required this.token, required this.user});
  final String token;
  final Map<String, dynamic> user;
  String get role => user['role'] as String? ?? '';
  String get name => user['name'] as String? ?? '';
  String get companyName => user['companyName'] as String? ?? '';
}

/// Thin HTTP client for the School Bus API.
class Api {
  Api._();
  static final Api instance = Api._();

  Session? session;

  Future<Session?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token');
    final user = prefs.getString('user');
    if (token == null || user == null) return null;
    session = Session(token: token, user: jsonDecode(user) as Map<String, dynamic>);
    return session;
  }

  Future<void> saveSession(Map<String, dynamic> login) async {
    final prefs = await SharedPreferences.getInstance();
    session = Session(token: login['token'] as String, user: (login['user'] as Map).cast<String, dynamic>());
    await prefs.setString('token', session!.token);
    await prefs.setString('user', jsonEncode(session!.user));
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
    session = null;
  }

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body);
  Future<dynamic> delete(String path) => _send('DELETE', path);

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final uri = Uri.parse('$apiUrl/api/v1$path');
    final headers = <String, String>{
      'content-type': 'application/json',
      if (session != null) 'authorization': 'Bearer ${session!.token}',
    };
    final req = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    final http.Response res;
    try {
      res = await http.Response.fromStream(await req.send().timeout(const Duration(seconds: 25)));
    } catch (_) {
      throw ApiException(0, 'No internet connection. Please try again.');
    }
    final data = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final msg = data is Map ? data['message'] : null;
      throw ApiException(
        res.statusCode,
        msg is List ? msg.join(', ') : (msg?.toString() ?? 'Something went wrong (${res.statusCode})'),
        data,
      );
    }
    return data;
  }
}

String todayIst([int offsetDays = 0]) {
  final t = DateTime.now().toUtc().add(Duration(hours: 5, minutes: 30, days: offsetDays));
  return '${t.year.toString().padLeft(4, '0')}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
}

const statusLabel = <String, String>{
  'SCHEDULED': 'Waiting',
  'ABSENT': 'Absent',
  'BOARDED': 'On the bus',
  'NO_SHOW': 'Not at stop',
  'AT_SCHOOL': 'At school',
  'HANDED_OVER': 'Handed over',
  'DROPPED_ALONE': 'Dropped off',
  'HELD': 'Held on bus',
  'RETURNED': 'Returned',
  'IN_PROGRESS': 'Running',
  'COMPLETED': 'Completed',
  'PENDING_APPROVAL': 'Waiting for approval',
  'ACTIVE': 'Active',
  'PAID': 'Paid',
  'PARTLY_PAID': 'Part paid',
  'PENDING': 'Due',
  'OVERDUE': 'Overdue',
  'CANCELLED': 'Cancelled',
};
