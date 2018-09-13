const longComputation = () => {
    let sum = 0;
    for (let i = 0; i < 1e10; i++) {
        sum += i;
    };
    return sum;
};

process.on('message', (msg) => {
    console.log(`[SLIDE-PARSER] Process received message: ${msg}.`);
    const sum = longComputation();
    if (process.send) {
        process.send(sum);
    } else {
        console.log(`[SLIDE-PARSER] Can't send message about operation complete. process.send is 'undefined'`);
    }
});
