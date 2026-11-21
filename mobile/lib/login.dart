import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

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
          if (_demoCode != null) _code.text = _demoCode!; // demo mode: fill it in for the user
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
      backgroundColor: navy,
      body: SingleChildScrollView(
        child: Column(children: [
          // Animated header: a bus driving along the road.
          Container(
            height: 300,
            width: double.infinity,
            decoration: const BoxDecoration(gradient: headerGradient),
            child: SafeArea(
              child: Column(children: [
                const SizedBox(height: 18),
                ClipRRect(borderRadius: BorderRadius.circular(20), child: Image.asset('assets/icon.png', width: 72, height: 72))
                    .animate()
                    .scale(begin: const Offset(0.6, 0.6), end: const Offset(1, 1), duration: 500.ms, curve: Curves.easeOutBack),
                const SizedBox(height: 12),
                const Text('School Bus', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800))
                    .animate()
                    .fadeIn(delay: 150.ms),
                Text('Know where the bus is. Always.', style: TextStyle(color: Colors.white.withValues(alpha: 0.75)))
                    .animate()
                    .fadeIn(delay: 300.ms),
                const Spacer(),
                const SizedBox(height: 70, child: _RoadScene()),
              ]),
            ),
          ),
          // Form card
          Container(
            constraints: BoxConstraints(minHeight: MediaQuery.of(context).size.height - 300),
            decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 350),
              transitionBuilder: (child, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0.08, 0), end: Offset.zero).animate(a), child: child)),
              child: KeyedSubtree(key: ValueKey(_step), child: _form()),
            ),
          ).animate().slideY(begin: 0.15, end: 0, duration: 500.ms, curve: Curves.easeOutCubic),
        ]),
      ),
    );
  }

  Widget _form() {
    final title = switch (_step) {
      _Step.phone => 'Log in with your mobile',
      _Step.code => 'Enter the code',
      _Step.register => 'Create your parent account',
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: ink)),
      const SizedBox(height: 6),
      if (widget.message != null) ...[
        Text(widget.message!, style: TextStyle(color: Colors.red.shade700)),
        const SizedBox(height: 8),
      ],
      if (_step == _Step.phone) ...[
        Text('Parents, drivers and attendants use the same app.', style: TextStyle(color: Colors.grey.shade600)),
        const SizedBox(height: 22),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          style: const TextStyle(fontSize: 18, letterSpacing: 1),
          decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91  ', prefixIcon: Icon(Icons.phone_iphone)),
        ),
        const SizedBox(height: 18),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
          onPressed: _busy ? null : _sendCode,
          child: _busy ? const _Dots() : const Text('Send code', style: TextStyle(fontSize: 17)),
        ),
      ],
      if (_step == _Step.code) ...[
        Text('We sent a 6-digit code to +91 ${_phone.text}', style: TextStyle(color: Colors.grey.shade600)),
        const SizedBox(height: 18),
        if (_demoCode != null)
          Container(
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 14),
            decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(12)),
            child: Row(children: [
              const Icon(Icons.auto_awesome, color: amber, size: 20),
              const SizedBox(width: 8),
              Expanded(child: Text('Demo mode: code $_demoCode is filled in. Just tap Log in.')),
            ]),
          ).animate().fadeIn().shake(hz: 2, offset: const Offset(2, 0), duration: 500.ms),
        TextField(
          controller: _code,
          keyboardType: TextInputType.number,
          maxLength: 6,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 26, letterSpacing: 12, fontWeight: FontWeight.w700),
          decoration: const InputDecoration(counterText: '', hintText: '••••••'),
        ),
        const SizedBox(height: 18),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
          onPressed: _busy ? null : () => _verify(),
          child: _busy ? const _Dots() : const Text('Log in', style: TextStyle(fontSize: 17)),
        ),
        TextButton(onPressed: _busy ? null : () => setState(() => _step = _Step.phone), child: const Text('Change number')),
      ],
      if (_step == _Step.register) ...[
        Text('This number isn’t registered yet. Parents can sign up with their bus company’s code.', style: TextStyle(color: Colors.grey.shade600)),
        const SizedBox(height: 18),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Your name', prefixIcon: Icon(Icons.person_outline))),
        const SizedBox(height: 12),
        TextField(controller: _company, decoration: const InputDecoration(labelText: 'Bus company code', hintText: 'e.g. demo-transport', prefixIcon: Icon(Icons.business_outlined))),
        const SizedBox(height: 18),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
          onPressed: _busy ? null : _register,
          child: _busy ? const _Dots() : const Text('Sign up as a parent', style: TextStyle(fontSize: 17)),
        ),
        TextButton(onPressed: () => setState(() => _step = _Step.phone), child: const Text('Back')),
      ],
    ]);
  }
}

/// Three bouncing dots for "working…".
class _Dots extends StatelessWidget {
  const _Dots();

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      for (var i = 0; i < 3; i++)
        Container(
          width: 8,
          height: 8,
          margin: const EdgeInsets.symmetric(horizontal: 3),
          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
        ).animate(onPlay: (c) => c.repeat(reverse: true), delay: (120 * i).ms).moveY(begin: 3, end: -3, duration: 350.ms),
    ]);
  }
}

/// A road with moving lane marks and a bobbing bus.
class _RoadScene extends StatefulWidget {
  const _RoadScene();

  @override
  State<_RoadScene> createState() => _RoadSceneState();
}

class _RoadSceneState extends State<_RoadScene> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) => CustomPaint(
        painter: _RoadPainter(_c.value),
        child: Align(
          alignment: const Alignment(-0.15, -0.35),
          child: Transform.translate(
            offset: Offset(0, math.sin(_c.value * math.pi * 4) * 1.5),
            child: const Text('🚌', style: TextStyle(fontSize: 40)),
          ),
        ),
      ),
    );
  }
}

class _RoadPainter extends CustomPainter {
  _RoadPainter(this.t);
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final road = Paint()..color = const Color(0xFF0E141B);
    canvas.drawRect(Rect.fromLTWH(0, size.height - 26, size.width, 26), road);
    final mark = Paint()..color = brand;
    const dash = 26.0, gap = 22.0;
    final shift = t * (dash + gap);
    for (double x = -dash - shift; x < size.width; x += dash + gap) {
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, size.height - 15, dash, 4), const Radius.circular(2)), mark);
    }
    // passing roadside dots
    final dot = Paint()..color = Colors.white.withValues(alpha: 0.25);
    for (double x = -(t * 120); x < size.width; x += 120) {
      canvas.drawCircle(Offset(x + 40, size.height - 36), 3, dot);
    }
  }

  @override
  bool shouldRepaint(_RoadPainter old) => old.t != t;
}
