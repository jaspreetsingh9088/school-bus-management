import 'package:flutter/material.dart';

import 'api.dart';
import 'main.dart';

/// Mobile number + OTP login. New parents can sign up with their bus company's code.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.message});
  final String? message;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { phone, code, register }

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _company = TextEditingController();
  final _name = TextEditingController();
  _Step _step = _Step.phone;
  bool _busy = false;
  String? _demoCode;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() => _run(() async {
        final res = await Api.instance.post('/auth/otp/request', {'phone': _phone.text.trim()});
        setState(() {
          _demoCode = res['demoCode'] as String?;
          _step = _Step.code;
        });
      });

  Future<void> _verify({bool register = false}) => _run(() async {
        final body = <String, dynamic>{'phone': _phone.text.trim(), 'code': _code.text.trim()};
        if (register) {
          body['companySlug'] = _company.text.trim().toLowerCase();
          body['name'] = _name.text.trim();
        }
        final res = await Api.instance.post('/auth/otp/verify', body) as Map<String, dynamic>;
        if (res['needsRegistration'] == true) {
          // The code was used up; ask for a new one when they submit the sign-up form.
          setState(() => _step = _Step.register);
          return;
        }
        if (res['chooseAccount'] == true) {
          final picked = await _pickAccount((res['accounts'] as List).cast<Map>());
          if (picked == null) return;
          final login = await Api.instance.post('/auth/select-account', {'ticket': res['ticket'], 'userId': picked});
          await _finish(login as Map<String, dynamic>);
          return;
        }
        await _finish(res);
      });

  Future<void> _register() => _run(() async {
        // A fresh code is needed because the first one was used to check the number.
        final res = await Api.instance.post('/auth/otp/request', {'phone': _phone.text.trim()});
        _demoCode = res['demoCode'] as String?;
        if (_demoCode != null) {
          _code.text = _demoCode!;
        } else {
          final entered = await _askCode();
          if (entered == null) return;
          _code.text = entered;
        }
        setState(() => _busy = false);
        await _verify(register: true);
      });

  Future<String?> _askCode() {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Enter the new code'),
        content: TextField(controller: c, keyboardType: TextInputType.number, maxLength: 6),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('OK'))],
      ),
    );
  }

  Future<String?> _pickAccount(List<Map> accounts) {
    return showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Which account?'),
        children: [
          for (final a in accounts)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, a['userId'] as String),
              child: Text('${a['companyName'] ?? 'Account'} — ${(a['role'] as String).toLowerCase()}'),
            ),
        ],
      ),
    );
  }

  Future<void> _finish(Map<String, dynamic> login) async {
    await Api.instance.saveSession(login);
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => homeFor(Api.instance.session)), (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 24),
            Center(
              child: Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(color: brand, borderRadius: BorderRadius.circular(22)),
                child: const Center(child: Text('🚌', style: TextStyle(fontSize: 44))),
              ),
            ),
            const SizedBox(height: 16),
            Text('School Bus', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
            const Text('For parents, drivers and attendants', textAlign: TextAlign.center),
            const SizedBox(height: 28),
            if (widget.message != null) ...[
              Text(widget.message!, style: TextStyle(color: Colors.red.shade700)),
              const SizedBox(height: 12),
            ],
            if (_step == _Step.phone) ...[
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 ', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 16),
              FilledButton(onPressed: _busy ? null : _sendCode, child: const Text('Send code')),
            ],
            if (_step == _Step.code) ...[
              Text('Enter the 6-digit code sent to ${_phone.text}'),
              const SizedBox(height: 12),
              if (_demoCode != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(8)),
                  child: Text('Demo mode: the code is $_demoCode'),
                ),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(labelText: 'Code', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 8),
              FilledButton(onPressed: _busy ? null : () => _verify(), child: const Text('Log in')),
              TextButton(onPressed: _busy ? null : () => setState(() => _step = _Step.phone), child: const Text('Change number')),
            ],
            if (_step == _Step.register) ...[
              const Text('This number isn’t registered yet. Parents can sign up with the code from their bus company.'),
              const SizedBox(height: 12),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'Your name', border: OutlineInputBorder())),
              const SizedBox(height: 12),
              TextField(
                controller: _company,
                decoration: const InputDecoration(labelText: 'Bus company code (e.g. demo-transport)', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 16),
              FilledButton(onPressed: _busy ? null : _register, child: const Text('Sign up as a parent')),
              TextButton(onPressed: () => setState(() => _step = _Step.phone), child: const Text('Back')),
            ],
            if (_busy) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
          ],
        ),
      ),
    );
  }
}
