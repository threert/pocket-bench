// 桌面气象站, the UI: the temperature as the big number, humidity and
// pressure beside it, the last minute as a chart with the 30 °C line. Above
// 30 °C the temperature turns red and the screen says 太热了.
import { createMemo, Match, Switch } from "solid-js";
import { mount } from "@pocketjs/framework/solid";
import { GAP, State, Status } from "./protocol";
import { Bar, Card, Chart, Chip, Col, Header, Label, Notice, Row, Screen, Spacer, Stat, mix, theme, useChannel } from "./ui";

/** Above this the app raises its alert. */
const HOT = 30;

mount(() => {
  const state = useChannel("state", State);
  const live = () => state().status === Status.live;
  const hot = () => live() && state().celsius > HOT;
  const history = createMemo(() => state().celsiusHistory.map(value => value === GAP ? undefined : value / 100));
  /** Degrees gained over the last ten seconds. */
  const trend = createMemo(() => {
    const points = history().slice(-10).filter((value): value is number => value !== undefined);
    return points.length < 4 ? 0 : points[points.length - 1]! - points[0]!;
  });
  const range = createMemo(() => {
    const points = history().filter((value): value is number => value !== undefined);
    return points.length ? { low: Math.min(...points), high: Math.max(...points) } : undefined;
  });
  const comfort = () => state().humidity > 70 ? "潮湿" : state().humidity < 30 ? "干燥" : "舒适";

  return <Screen>
    <Header title="桌面气象站" subtitle="ENV III · Port A"
      status={live() ? "实时" : state().status === Status.fault ? "读数出错" : "未连接"}
      tone={live() ? "good" : state().status === Status.fault ? "bad" : "neutral"} />
    <Switch>
      <Match when={state().status === Status.missing}>
        <Notice title="请插上 ENV III 模块" lines={["把『温湿度气压』模块接到 Port A（红色接口），", "读数会自己出现在这里。"]} />
      </Match>
      <Match when={state().status === Status.fault}>
        <Notice title="传感器读数出错" tone="bad" lines={["模块有回应，但数据校验没通过。", "把它拔下来重新插一次试试。"]} />
      </Match>
      <Match when={live()}>
        <Row gap={12} grow align="stretch">
          <Card title="温度" w={236} justify="between" color={hot() ? mix(theme().panel, theme().bad, 0.16) : undefined} border={hot() ? theme().bad : undefined}>
            <Col gap={10} align="start">
              <Stat value={state().celsius.toFixed(1)} unit="°C" tone={hot() ? "bad" : "text"} />
              <Switch fallback={<Chip tone="good" dot>平稳</Chip>}>
                <Match when={hot()}><Chip tone="bad" solid>太热了</Chip></Match>
                <Match when={trend() > 0.3}><Chip tone="warn">↑ 正在升温</Chip></Match>
                <Match when={trend() < -0.3}><Chip tone="info">↓ 正在降温</Chip></Match>
              </Switch>
            </Col>
            <Col gap={2}>
              <Label size="xs" tone="muted">一分钟内</Label>
              <Label size="sm" bold>{range() ? `${range()!.low.toFixed(1)} ~ ${range()!.high.toFixed(1)} °C` : "还在攒数据"}</Label>
            </Col>
          </Card>
          <Col gap={12} grow>
            <Row gap={12} align="stretch">
              <Card title="湿度" grow gap={10}>
                <Row gap={8} align="end">
                  <Stat value={state().humidity.toFixed(0)} unit="%" size="md" />
                  <Spacer />
                  <Chip tone={comfort() === "舒适" ? "good" : "info"}>{comfort()}</Chip>
                </Row>
                <Bar value={state().humidity / 100} tone="info" h={8} />
              </Card>
              <Card title="气压" grow gap={10}>
                <Stat value={(state().pascals / 100).toFixed(1)} unit="hPa" size="md" />
                <Label size="xs" tone="muted">{state().pascals > 101_325 ? "比标准大气压高一点" : "比标准大气压低一点"}</Label>
              </Card>
            </Row>
            <Card title="最近一分钟的温度" grow gap={6}>
              <Chart values={history()} grow minSpan={2} unit="°" tone={hot() ? "bad" : "accent"} mark={HOT} markColor={theme().bad} />
            </Card>
          </Col>
        </Row>
      </Match>
    </Switch>
  </Screen>;
});
